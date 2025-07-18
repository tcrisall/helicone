import * as Sentry from "@sentry/node";
import { validate as uuidValidate } from "uuid";
import { dataDogClient } from "../../lib/clients/DataDogClient";
import { HeliconeQueueProducer } from "../../lib/clients/HeliconeQueueProducer";
import { HeliconeScoresMessage } from "../../lib/handlers/HandlerContext";
import { AuthParams } from "../../packages/common/auth/types";
import { DelayedOperationService } from "../../lib/shared/delayedOperationService";
import { err, ok, Result } from "../../packages/common/result";
import { Score, ScoreStore } from "../../lib/stores/ScoreStore";
import { BaseManager } from "../BaseManager";

type Scores = Record<string, number | boolean | undefined>;

export interface ScoreRequest {
  scores: Scores;
}

export function mapScores(scores: Scores): Score[] {
  return Object.entries(scores).map(([key, value]) => {
    if (typeof value === "boolean") {
      // Convert booleans to integers (1 for true, 0 for false)
      return {
        score_attribute_key: key,
        score_attribute_type: "boolean",
        score_attribute_value: value ? 1 : 0,
      };
    } else if (typeof value === "number") {
      // Check if the number is an integer
      if (Number.isInteger(value)) {
        return {
          score_attribute_key: key,
          score_attribute_type: "number",
          score_attribute_value: value,
        };
      } else {
        // Throw an error if the value is a float
        throw new Error(
          `Score value for key '${key}' must be an integer. Received: ${value}`
        );
      }
    } else {
      // Throw an error if the value is neither boolean nor number
      throw new Error(
        `Invalid score value for key '${key}': ${value}. Expected an integer or boolean.`
      );
    }
  });
}

export class ScoreManager extends BaseManager {
  private scoreStore: ScoreStore;
  private kafkaProducer: HeliconeQueueProducer;

  constructor(authParams: AuthParams) {
    super(authParams);
    this.scoreStore = new ScoreStore(authParams.organizationId);
    this.kafkaProducer = new HeliconeQueueProducer();
  }
  private getDefaultDelayMs(): number {
    return process.env.NODE_ENV === "production" ? 10 * 60 * 1000 : 0; // 10 minutes in milliseconds
  }

  public async addScores(
    requestId: string,
    scores: Scores,
    delayMs?: number,
    evaluatorId?: string
  ): Promise<Result<null, string>> {
    const mappedScores = mapScores(scores);
    await this.scoreStore.putScoresIntoDB(requestId, mappedScores, evaluatorId);
    const res = await this.addBatchScores(
      [
        {
          requestId,
          scores: mappedScores,
          organizationId: this.authParams.organizationId,
          createdAt: new Date(),
        },
      ],
      delayMs
    );
    if (res.error) {
      return err(`Error adding scores: ${res.error}`);
    }
    return ok(null);
  }

  public async addBatchScores(
    scoresMessage: HeliconeScoresMessage[],
    delayMs?: number
  ): Promise<Result<null, string>> {
    if (!this.kafkaProducer.isQueueEnabled()) {
      console.log("Kafka is not enabled. Using score manager");

      // run it immediately once
      this.handleScores(
        {
          batchId: "",
          partition: 0,
          lastOffset: "",
          messageCount: 1,
        },
        scoresMessage
      );

      // Schedule the delayed operation and register it with ShutdownService
      const timeoutId = DelayedOperationService.getTimeoutId(() => {
        return this.handleScores(
          {
            batchId: "",
            partition: 0,
            lastOffset: "",
            messageCount: 1,
          },
          scoresMessage
        );
      }, delayMs ?? this.getDefaultDelayMs());

      // Register the timeout and operation with ShutdownService
      DelayedOperationService.getInstance().addDelayedOperation(timeoutId, () =>
        this.handleScores(
          {
            batchId: "",
            partition: 0,
            lastOffset: "",
            messageCount: 1,
          },
          scoresMessage
        )
      );

      return ok(null);
    }

    console.log("Sending scores message to Kafka");

    // run it immediately once
    this.kafkaProducer
      .sendScoresMessage(scoresMessage, "helicone-scores-prod")
      .catch((error) => {
        console.error("Error sending scores message to Kafka:", error);
      });

    // Schedule the Kafka send operation and register it with ShutdownService
    const timeoutId = setTimeout(() => {
      this.kafkaProducer
        .sendScoresMessage(scoresMessage, "helicone-scores-prod")
        .catch((error) => {
          console.error("Error sending scores message to Kafka:", error);
        });
    }, delayMs);

    // Register the timeout and operation with ShutdownService
    DelayedOperationService.getInstance().addDelayedOperation(timeoutId, () =>
      this.kafkaProducer.sendScoresMessage(
        scoresMessage,
        "helicone-scores-prod"
      )
    );

    return ok(null);
  }

  private async procesScores(
    scoresMessages: HeliconeScoresMessage[]
  ): Promise<Result<null, string>> {
    try {
      if (scoresMessages.length === 0) {
        return ok(null);
      }
      const validScoresMessages = scoresMessages.filter((message) =>
        uuidValidate(message.requestId)
      );
      // Filter out duplicate scores messages and only keep the latest one
      const filteredMessages = Array.from(
        validScoresMessages
          .reduce((map, message) => {
            const key = `${message.requestId}-${message.organizationId}`;
            const existingMessage = map.get(key);
            if (
              !existingMessage ||
              existingMessage.createdAt < message.createdAt
            ) {
              map.set(key, message);
            }
            return map;
          }, new Map<string, HeliconeScoresMessage>())
          .values()
      );

      const scoresScoreResult = await this.scoreStore.putScoresIntoClickhouse(
        filteredMessages.map((scoresMessage) => {
          return {
            requestId: scoresMessage.requestId,
            organizationId: scoresMessage.organizationId,
            mappedScores:
              filteredMessages
                .find((x) => x.requestId === scoresMessage.requestId)
                ?.scores.map((score) => {
                  if (score.score_attribute_type === "boolean") {
                    return {
                      ...score,
                      score_attribute_key: `${score.score_attribute_key}-hcone-bool`,
                    };
                  }
                  return score;
                }) ?? [],
          };
        })
      );

      if (
        scoresScoreResult.error ||
        !scoresScoreResult.data ||
        scoresScoreResult.data.length === 0
      ) {
        console.error("Error upserting scores:", scoresScoreResult.error);
        return err(scoresScoreResult.error);
      }

      const feedbackResult = await this.scoreStore.bulkUpsertFeedback(
        scoresScoreResult.data
          .filter(
            (requestResponseRow) =>
              "helicone-score-feedback" in requestResponseRow.scores &&
              requestResponseRow.response_id !== null
          )
          .map((requestResponseRow) => ({
            responseId: requestResponseRow.response_id!,
            rating: Boolean(
              requestResponseRow.scores["helicone-score-feedback"]
            ),
          }))
      );
      if (feedbackResult.error) {
        console.error("Error upserting feedback:", feedbackResult.error);
        return err(feedbackResult.error);
      }
      return ok(null);
    } catch (error: any) {
      console.error("Error processing scores message:", error.message);
      return err(error.message);
    }
  }

  public async handleScores(
    batchContext: {
      batchId: string;
      partition: number;
      lastOffset: string;
      messageCount: number;
    },
    scoresMessages: HeliconeScoresMessage[]
  ): Promise<void> {
    console.log(`Handling scores for batch ${batchContext.batchId}`);
    const start = performance.now();
    const result = await this.procesScores(scoresMessages);
    const end = performance.now();
    const executionTimeMs = end - start;

    dataDogClient.logHandleResults({
      executionTimeMs,
      handlerName: "scoresHandler",
      methodName: "handlescores",
      messageCount: batchContext.messageCount,
      message: "scores",
    });

    if (result.error) {
      Sentry.captureException(new Error(JSON.stringify(result.error)), {
        tags: {
          type: "HandlescoresError",
          topic: "helicone-scores-prod",
        },
        extra: {
          batchId: batchContext.batchId,
          partition: batchContext.partition,
          offset: batchContext.lastOffset,
          messageCount: batchContext.messageCount,
        },
      });

      console.error(
        `Error inserting scores: ${JSON.stringify(result.error)} for batch ${
          batchContext.batchId
        }`
      );

      const kafkaProducer = new HeliconeQueueProducer();
      const kafkaResult = await kafkaProducer.sendScoresMessage(
        scoresMessages,
        "helicone-scores-prod-dlq"
      );

      if (kafkaResult.error) {
        Sentry.captureException(new Error(kafkaResult.error), {
          tags: {
            type: "KafkaError",
            topic: "helicone-scores-prod-dlq",
          },
          extra: {
            batchId: batchContext.batchId,
            partition: batchContext.partition,
            offset: batchContext.lastOffset,
            messageCount: batchContext.messageCount,
          },
        });
      }
    }
    console.log("Successfully processed scores messages");
  }
}

import { costOfPrompt } from "./index";

export const COST_PRECISION_MULTIPLIER = 1_000_000_000;

export function modelCost(
  modelRow: {
    provider: string;
    model: string;
    sum_prompt_tokens: number;
    prompt_cache_write_tokens: number;
    prompt_cache_read_tokens: number;
    prompt_audio_tokens: number;
    sum_completion_tokens: number;
    completion_audio_tokens: number;
    sum_tokens: number;
    per_call?: number;
    per_image?: number;
    multiple?: number;
  },
): number {
  return (
    costOfPrompt({
      provider: modelRow.provider,
      model: modelRow.model,
      promptTokens: modelRow.sum_prompt_tokens,
      promptCacheWriteTokens: modelRow.prompt_cache_write_tokens,
      promptCacheReadTokens: modelRow.prompt_cache_read_tokens,
      promptAudioTokens: modelRow.prompt_audio_tokens,
      completionTokens: modelRow.sum_completion_tokens,
      completionAudioTokens: modelRow.completion_audio_tokens,
      perCall: modelRow.per_call,
      images: modelRow.per_image,
      multiple: modelRow.multiple,
    }) ?? 0
  );
}

Helicone: All-in-One Containerized Fork
This repository is a customized fork of Helicone/helicone, in which I’ve bundled all the required components into a single Docker container for easy deployment on my home Kubernetes cluster.

The real accomplishment here is being able to deploy Helicone and access it directly via its IP address—no reliance on localhost or Docker’s default networking assumptions.

Purpose
The main reason for this setup is to have Helicone sit in the middle between Open-WebUI and Ollama.
With Ollama’s support for the OpenAI API, this arrangement allows Open-WebUI to send API calls through Helicone, which in turn proxies requests to Ollama.
A key part of this is using the special Helicone header "Helicone-Target-URL".
This header lets you override the destination “OpenAI” endpoint and direct traffic wherever you want.

NGINX in Place of Kong
To get Helicone working in this environment, I added NGINX to the mix.
NGINX replaces Kong to handle URL rewriting (such as stripping off Supabase’s /rest/v1 prefix for PostgREST) and injects the required Helicone header.
Since NGINX is already present, I have it listening on an additional port to handle header injection for Open-WebUI traffic, allowing Helicone to be configured as a standard OpenAI-compatible host in Open-WebUI.

Security out the window
I couldn't get postgrest to drag queries out of postgresql using the role 'service_role' so the SUPABASE_SERVICE_ROLE_KEY is set to use postgres (don't do this in production kids).
 
What’s Different in This Fork?
Single-container approach: All required Helicone components (app, database, NGINX, PostgREST) are bundled into a single container for simpler deployment on Kubernetes.

Kubernetes/IP ready: Designed to work seamlessly with real IP addresses and Kubernetes networking, not all localhost.

NGINX instead of Kong: NGINX acts as the reverse proxy, handling URL rewriting and injecting the Helicone-Target-URL header for Ollama support.

Open-WebUI compatibility: Helicone can be set as the OpenAI endpoint in Open-WebUI, transparently proxying requests to Ollama (or another endpoint).

Logging and transparency: The main goal is to capture, log, and inspect traffic between Open-WebUI and Ollama for learning.

Note:
This is a pragmatic, experimental build NOT production-hardened!
Expect rough edges; this is a very hacky job. Good luck and cheers if you decide to use any of this.

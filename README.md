<h4>Helicone: All-in-One Containerized Fork</h4>
This repository is a customized fork of Helicone/helicone, in which I’ve bundled all the required components into a single Docker container for easy deployment on my home Kubernetes cluster.

The real accomplishment here is being able to deploy Helicone and access it directly via its IP address—no reliance on localhost or Docker’s default networking assumptions.

<h4>Purpose</h4>
The main reason for this setup is to have Helicone sit in the middle between Open-WebUI and Ollama.
With Ollama’s support for the OpenAI API, this arrangement allows Open-WebUI to send API calls through Helicone, which in turn proxies requests to Ollama.
A key part of this is using the special Helicone header "Helicone-Target-URL".
This header lets you override the destination “OpenAI” endpoint and direct traffic wherever you want.

<h4>NGINX in Place of Kong</h4>
To get Helicone working in this environment, I added NGINX to the mix.
NGINX replaces Kong to handle URL rewriting (such as stripping off Supabase’s /rest/v1 prefix for PostgREST) and injects the required Helicone header.
Since NGINX is already present, I have it listening on an additional port to handle header injection for Open-WebUI traffic, allowing Helicone to be configured as a standard OpenAI-compatible host in Open-WebUI.

<h4>Security out the window</h4>
I couldn't get postgrest to drag queries out of postgresql using the role 'service_role' so the SUPABASE_SERVICE_ROLE_KEY is set to use postgres (don't do this in production kids).
 
<h4>What’s Different in This Fork?</h4>
<ul>
<li>Single-container approach: All required Helicone components (app, database, NGINX, PostgREST) are bundled into a single container for simpler deployment on Kubernetes.</li>
<li>Kubernetes/IP ready: Designed to work seamlessly with real IP addresses and Kubernetes networking, not all localhost.</li>
<li>NGINX instead of Kong: NGINX acts as the reverse proxy, handling URL rewriting and injecting the Helicone-Target-URL header for Ollama support.</li>
<li>Open-WebUI compatibility: Helicone can be set as the OpenAI endpoint in Open-WebUI, transparently proxying requests to Ollama (or another endpoint).</li>
<li>Logging and transparency: The main goal is to capture, log, and inspect traffic between Open-WebUI and Ollama for learning.</li>
</ul>
<h4>Note:</h4>
<p>This is a pure hackery, experimental build NOT production-hardened!
Expect rough edges; this is a very hacky job. Good luck and cheers if you decide to use any of this.</p>
<p>I've setup persistent storage so bootstrapping the container is a bit challenging. I'm making these notes from memory so this may not be entirely correct... Three 'migration' jobs are defined in supervisord.conf, I've set them to not start automatically. This means that nothing will work on first boot, you have to exec into the pod and manually start the 3 migration jobs. After running them once, destroy the pod and things should work when the new pod shows up.</p>
<p>There are a ton of ports defined.  The one's that I use are 3100 (which redirects to 3000 - the web ui) and 8786 (which is the nginx proxy which fiddles with headers then hands things to port 8787).</p>
<p>I've had great success using Open-WebUI to talk thru Helicone to my local Ollama. When starting Open-WebUI make sure you set ENABLE_FORWARD_USER_INFO_HEADERS=true in order to get username logging to work.  I've also had OpenHands talk thru Helicone which is fascinating but I've not bothered to do anything about username logging with it.</p>

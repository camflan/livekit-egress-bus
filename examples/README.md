# Examples

## Simple example

Start up Valkey and Egress node(s) with docker compose,

    docker compose up

To start up multiple Egress in a cluster, use the scale command or change scale using a docker-compose.override.yml file

    docker compose scale egress=5

After Valkey and Egress node(s) are up, start an RPC server to communicate with the Egress cluster,

    npm run example:simple:server

This handles requests from the Egress cluster, acting as the LiveKit control plane/server. Egress is stateless, so it relies upon a control plane to persist data. You may start up as many RPC servers as you like to simulate a cluster of application servers each with their own RPC server instance

Start up Egress requests to record demo URLs with the client,

    npm run example:simple:client

Use `Ctrl-c` to cancel the Egress Request that you've started. Use multiple terminals to start many Requests at once.

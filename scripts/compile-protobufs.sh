#! /bin/sh

set -Eeuo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd -P)
project_root=$(dirname $script_dir)
output_directory="$project_root/src/generated"
contrib_root="$project_root/contrib"

echo "Removing generated files directory…"
rm -rf $output_directory
echo "Recreating generated files directory…"
mkdir -p $output_directory

echo "Compiling…"
protoc \
    --plugin=./node_modules/.bin/protoc-gen-ts_proto \
    --ts_proto_opt=enumsAsLiterals=true \
    --ts_proto_opt=env=node \
    --ts_proto_opt=forceLong=bigint \
    --ts_proto_opt=outputClientImpl=false \
    --ts_proto_opt=outputSchema=const \
    --ts_proto_opt=outputServices=false \
    --ts_proto_opt=outputTypeRegistry=true \
    --ts_proto_opt=useJsonName=true \
    --ts_proto_out=$output_directory \
    --proto_path=$contrib_root/livekit-protocol/protobufs \
    --proto_path=$contrib_root/livekit-psrpc/internal \
    --proto_path=$contrib_root/livekit-psrpc/protoc-gen-psrpc/options \
    internal.proto options.proto rpc/egress.proto rpc/io.proto rpc/keepalive.proto livekit_metrics.proto livekit_models.proto livekit_egress.proto

echo "done"

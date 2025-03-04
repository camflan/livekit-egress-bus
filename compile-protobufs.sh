#! /bin/sh

set -Eeuo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" &>/dev/null && pwd -P)

output_directory=$script_dir/src/generated
livekit_protocol_root=$script_dir/contrib/livekit-protocol
protobufs_root=$livekit_protocol_root/protobufs

proto_files="livekit_metrics.proto livekit_models.proto livekit_egress.proto"

mkdir -p $output_directory
rm -rf $output_directory/**/*.proto

protoc \
    --plugin=./node_modules/.bin/protoc-gen-ts_proto \
    --ts_proto_out=$output_directory \
    --ts_proto_opt=importSuffix=.js \
    --ts_proto_opt=env=node \
    --ts_proto_opt=fileSuffix=.proto.ts \
    --ts_proto_opt=enumsAsLiterals=true \
    --ts_proto_opt=useJsonName=true \
    --proto_path=$protobufs_root \
    $proto_files




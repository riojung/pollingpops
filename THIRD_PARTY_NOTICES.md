# Third-party notices

This attribution index is generated from the production dependency graph pinned by
`pnpm-lock.yaml`. Regenerate it with `pnpm licenses:report` and review it together with
the release SBOM. Package and image distributions retain their complete license texts.
Platform-specific Sharp/libvips, Canvas, and Next.js SWC package names are normalized so this file
is reproducible across build hosts; exact native artifacts remain listed in each image SBOM.
This file is not legal advice.

## Application production dependencies

### 0BSD

| Package | Version | Project                                         |
| ------- | ------- | ----------------------------------------------- |
| tslib   | 2.8.1   | [Project page](https://www.typescriptlang.org/) |

### Apache-2.0

| Package                                    | Version  | Project                                                                                                                                      |
| ------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| @aws-sdk/checksums                         | 3.1001.1 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/checksums)                                                   |
| @aws-sdk/client-s3                         | 3.1146.0 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/clients/client-s3)                                                             |
| @aws-sdk/core                              | 3.978.1  | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/core)                                                        |
| @aws-sdk/credential-provider-env           | 3.972.72 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-env)                                     |
| @aws-sdk/credential-provider-http          | 3.972.74 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-http)                                    |
| @aws-sdk/credential-provider-ini           | 3.973.17 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-ini)                                     |
| @aws-sdk/credential-provider-login         | 3.972.79 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-login)                                   |
| @aws-sdk/credential-provider-node          | 3.972.84 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-node)                                    |
| @aws-sdk/credential-provider-process       | 3.972.72 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-process)                                 |
| @aws-sdk/credential-provider-sso           | 3.973.16 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-sso)                                     |
| @aws-sdk/credential-provider-web-identity  | 3.972.78 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/credential-provider-web-identity)                            |
| @aws-sdk/middleware-sdk-s3                 | 3.972.77 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/middleware-sdk-s3)                                           |
| @aws-sdk/nested-clients                    | 3.997.46 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/nested-clients)                                                       |
| @aws-sdk/s3-request-presigner              | 3.1146.0 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-request-presigner)                                                 |
| @aws-sdk/signature-v4-multi-region         | 3.996.47 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/signature-v4-multi-region)                                            |
| @aws-sdk/token-providers                   | 3.1138.0 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/token-providers)                                                      |
| @aws-sdk/types                             | 3.974.6  | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/types)                                                       |
| @aws-sdk/xml-builder                       | 3.972.41 | [Project page](https://github.com/aws/aws-sdk-js-v3/tree/main/packages-internal/xml-builder)                                                 |
| @aws/lambda-invoke-store                   | 0.3.0    | [Project page](https://github.com/awslabs/aws-lambda-invoke-store)                                                                           |
| @grpc/grpc-js                              | 1.14.5   | [Project page](https://grpc.io/)                                                                                                             |
| @grpc/proto-loader                         | 0.8.1    | [Project page](https://grpc.io/)                                                                                                             |
| @img/sharp-platform-binary                 | 0.35.5   | [Project page](https://sharp.pixelplumbing.com)                                                                                              |
| @opentelemetry/api                         | 1.9.1    | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/api)                                                             |
| @opentelemetry/api-logs                    | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/api-logs)                                  |
| @opentelemetry/configuration               | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/configuration)                             |
| @opentelemetry/context-async-hooks         | 2.11.0   | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-context-async-hooks)                      |
| @opentelemetry/core                        | 2.11.0   | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-core)                                     |
| @opentelemetry/exporter-logs-otlp-grpc     | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/exporter-logs-otlp-grpc)                   |
| @opentelemetry/exporter-logs-otlp-http     | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/exporter-logs-otlp-http)                   |
| @opentelemetry/exporter-logs-otlp-proto    | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/exporter-logs-otlp-proto)                  |
| @opentelemetry/exporter-metrics-otlp-grpc  | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-exporter-metrics-otlp-grpc)  |
| @opentelemetry/exporter-metrics-otlp-http  | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-exporter-metrics-otlp-http)  |
| @opentelemetry/exporter-metrics-otlp-proto | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-exporter-metrics-otlp-proto) |
| @opentelemetry/exporter-prometheus         | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-exporter-prometheus)         |
| @opentelemetry/exporter-trace-otlp-grpc    | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/exporter-trace-otlp-grpc)                  |
| @opentelemetry/exporter-trace-otlp-http    | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/exporter-trace-otlp-http)                  |
| @opentelemetry/exporter-trace-otlp-proto   | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/exporter-trace-otlp-proto)                 |
| @opentelemetry/exporter-zipkin             | 2.11.0   | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-exporter-zipkin)                          |
| @opentelemetry/instrumentation             | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-instrumentation)             |
| @opentelemetry/instrumentation-http        | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-instrumentation-http)        |
| @opentelemetry/otlp-exporter-base          | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/otlp-exporter-base)                        |
| @opentelemetry/otlp-grpc-exporter-base     | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/otlp-grpc-exporter-base)                   |
| @opentelemetry/otlp-transformer            | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/otlp-transformer)                          |
| @opentelemetry/propagator-b3               | 2.11.0   | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-propagator-b3)                            |
| @opentelemetry/propagator-jaeger           | 2.11.0   | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-propagator-jaeger)                        |
| @opentelemetry/resources                   | 2.11.0   | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-resources)                                |
| @opentelemetry/sdk-logs                    | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/sdk-logs)                                  |
| @opentelemetry/sdk-metrics                 | 2.11.0   | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/sdk-metrics)                                            |
| @opentelemetry/sdk-node                    | 0.222.0  | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-sdk-node)                    |
| @opentelemetry/sdk-trace                   | 2.11.0   | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/sdk-trace)                                              |
| @opentelemetry/sdk-trace-base              | 2.11.0   | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-trace-base)                           |
| @opentelemetry/sdk-trace-node              | 2.11.0   | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/packages/opentelemetry-sdk-trace-node)                           |
| @opentelemetry/semantic-conventions        | 1.43.0   | [Project page](https://github.com/open-telemetry/opentelemetry-js/tree/main/semantic-conventions)                                            |
| @playwright/test                           | 1.63.0   | [Project page](https://playwright.dev)                                                                                                       |
| @prometheus-io/client                      | 0.16.1   | [Project page](https://github.com/prometheus/client_js)                                                                                      |
| @smithy/core                               | 3.35.1   | [Project page](https://github.com/smithy-lang/smithy-typescript/tree/main/packages/core)                                                     |
| @smithy/credential-provider-imds           | 4.5.2    | [Project page](https://github.com/smithy-lang/smithy-typescript/tree/main/packages/credential-provider-imds)                                 |
| @smithy/fetch-http-handler                 | 5.8.0    | [Project page](https://github.com/smithy-lang/smithy-typescript/tree/main/packages/fetch-http-handler)                                       |
| @smithy/node-http-handler                  | 4.12.1   | [Project page](https://github.com/smithy-lang/smithy-typescript/tree/main/packages/node-http-handler)                                        |
| @smithy/signature-v4                       | 5.7.4    | [Project page](https://github.com/smithy-lang/smithy-typescript/tree/main/packages/signature-v4)                                             |
| @smithy/types                              | 4.19.0   | [Project page](https://github.com/smithy-lang/smithy-typescript/tree/main/packages/types)                                                    |
| @swc/helpers                               | 0.5.23   | [Project page](https://swc.rs)                                                                                                               |
| baseline-browser-mapping                   | 2.11.23  | [Project page](https://github.com/web-platform-dx/baseline-browser-mapping#readme)                                                           |
| cluster-key-slot                           | 1.1.1    | [Project page](https://github.com/Salakar/cluster-key-slot#readme)                                                                           |
| denque                                     | 2.1.0    | [Project page](https://docs.page/invertase/denque)                                                                                           |
| detect-libc                                | 2.1.2    | [Project page](https://github.com/lovell/detect-libc#readme)                                                                                 |
| import-in-the-middle                       | 3.5.1    | [Project page](https://github.com/nodejs/import-in-the-middle#readme)                                                                        |
| long                                       | 5.3.2    | [Project page](https://github.com/dcodeIO/long.js#readme)                                                                                    |
| pdfjs-dist                                 | 6.4.299  | [Project page](https://mozilla.github.io/pdf.js/)                                                                                            |
| playwright                                 | 1.63.0   | [Project page](https://playwright.dev)                                                                                                       |
| playwright-core                            | 1.63.0   | [Project page](https://playwright.dev)                                                                                                       |
| sharp                                      | 0.35.5   | [Project page](https://sharp.pixelplumbing.com)                                                                                              |

### BlueOak-1.0.0

| Package   | Version | Project                                                    |
| --------- | ------- | ---------------------------------------------------------- |
| minimatch | 10.2.6  | [Project page](https://github.com/isaacs/minimatch#readme) |

### BSD-2-Clause

| Package        | Version | Project                                                       |
| -------------- | ------- | ------------------------------------------------------------- |
| domelementtype | 3.0.0   | [Project page](https://github.com/fb55/domelementtype#readme) |
| domhandler     | 6.0.1   | [Project page](https://github.com/fb55/domhandler#readme)     |
| domutils       | 4.0.2   | [Project page](https://github.com/fb55/domutils#readme)       |
| entities       | 8.1.0   | [Project page](https://github.com/fb55/entities#readme)       |

### BSD-3-Clause

| Package                  | Version      | Project                                                             |
| ------------------------ | ------------ | ------------------------------------------------------------------- |
| @protobufjs/aspromise    | 1.1.2        | [Project page](https://github.com/dcodeIO/protobuf.js#readme)       |
| @protobufjs/base64       | 1.1.2        | [Project page](https://github.com/dcodeIO/protobuf.js#readme)       |
| @protobufjs/codegen      | 2.0.5        | [Project page](https://github.com/dcodeIO/protobuf.js#readme)       |
| @protobufjs/eventemitter | 1.1.1        | [Project page](https://github.com/dcodeIO/protobuf.js#readme)       |
| @protobufjs/fetch        | 1.1.1        | [Project page](https://github.com/dcodeIO/protobuf.js#readme)       |
| @protobufjs/float        | 1.0.2        | [Project page](https://github.com/dcodeIO/protobuf.js#readme)       |
| @protobufjs/path         | 1.1.2        | [Project page](https://github.com/dcodeIO/protobuf.js#readme)       |
| @protobufjs/pool         | 1.1.0        | [Project page](https://github.com/dcodeIO/protobuf.js#readme)       |
| @protobufjs/utf8         | 1.1.2        | [Project page](https://github.com/protobufjs/protobuf.js#readme)    |
| fast-uri                 | 3.1.8, 4.1.5 | [Project page](https://github.com/fastify/fast-uri)                 |
| light-my-request         | 6.6.0        | [Project page](https://github.com/fastify/light-my-request#readme)  |
| protobufjs               | 7.6.6        | [Project page](https://protobufjs.github.io/protobuf.js/)           |
| secure-json-parse        | 4.1.0        | [Project page](https://github.com/fastify/secure-json-parse#readme) |
| source-map-js            | 1.2.2        | [Project page](https://github.com/7rulnik/source-map-js)            |

### CC-BY-4.0

| Package      | Version      | Project                                                             |
| ------------ | ------------ | ------------------------------------------------------------------- |
| caniuse-lite | 1.0.30001810 | [Project page](https://github.com/browserslist/caniuse-lite#readme) |

### ISC

| Package          | Version | Project                                                                |
| ---------------- | ------- | ---------------------------------------------------------------------- |
| @msgpack/msgpack | 2.8.0   | [Project page](https://msgpack.org/)                                   |
| cliui            | 8.0.1   | [Project page](https://github.com/yargs/cliui#readme)                  |
| fastq            | 1.20.3  | [Project page](https://github.com/mcollina/fastq#readme)               |
| get-caller-file  | 2.0.5   | [Project page](https://github.com/stefanpenner/get-caller-file#readme) |
| inherits         | 2.0.4   | [Project page](https://github.com/isaacs/inherits#readme)              |
| pg-int8          | 1.0.1   | [Project page](https://github.com/charmander/pg-int8#readme)           |
| picocolors       | 1.1.1   | [Project page](https://github.com/alexeyraspopov/picocolors#readme)    |
| qrcode.react     | 4.2.0   | [Project page](http://zpao.github.io/qrcode.react)                     |
| semver           | 7.8.5   | [Project page](https://github.com/npm/node-semver#readme)              |
| setprototypeof   | 1.2.0   | [Project page](https://github.com/wesleytodd/setprototypeof)           |
| split2           | 4.2.0   | [Project page](https://github.com/mcollina/split2#readme)              |
| y18n             | 5.0.8   | [Project page](https://github.com/yargs/y18n)                          |
| yaml             | 2.9.1   | [Project page](https://eemeli.org/yaml/)                               |
| yargs-parser     | 21.1.1  | [Project page](https://github.com/yargs/yargs-parser#readme)           |

### LGPL-3.0-or-later

| Package                            | Version | Project                                         |
| ---------------------------------- | ------- | ----------------------------------------------- |
| @img/sharp-libvips-platform-binary | 1.3.4   | [Project page](https://sharp.pixelplumbing.com) |

### MIT

| Package                               | Version             | Project                                                                                             |
| ------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| @fastify/ajv-compiler                 | 4.0.6               | [Project page](https://github.com/fastify/ajv-compiler#readme)                                      |
| @fastify/cookie                       | 11.1.2              | [Project page](https://github.com/fastify/fastify-cookie#readme)                                    |
| @fastify/cors                         | 11.3.0              | [Project page](https://github.com/fastify/fastify-cors#readme)                                      |
| @fastify/error                        | 4.2.0               | [Project page](https://github.com/fastify/fastify-error#readme)                                     |
| @fastify/fast-json-stringify-compiler | 5.1.0               | [Project page](https://github.com/fastify/fast-json-stringify-compiler#readme)                      |
| @fastify/formbody                     | 9.0.0               | [Project page](https://github.com/fastify/fastify-formbody#readme)                                  |
| @fastify/forwarded                    | 3.0.2               | [Project page](https://github.com/fastify/forwarded#readme)                                         |
| @fastify/helmet                       | 13.1.1              | [Project page](https://github.com/fastify/fastify-helmet#readme)                                    |
| @fastify/merge-json-schemas           | 0.2.1               | [Project page](https://github.com/fastify/merge-json-schemas#readme)                                |
| @fastify/otel                         | 0.21.1              | [Project page](https://github.com/fastify/otel#readme)                                              |
| @fastify/proxy-addr                   | 5.1.0               | [Project page](https://github.com/fastify/proxy-addr#readme)                                        |
| @fastify/rate-limit                   | 11.2.0              | [Project page](https://github.com/fastify/fastify-rate-limit#readme)                                |
| @img/colour                           | 1.1.0               | [Project page](https://github.com/lovell/colour#readme)                                             |
| @ioredis/commands                     | 2.0.0               | [Project page](https://github.com/ioredis/commands)                                                 |
| @js-sdsl/ordered-map                  | 4.4.2               | [Project page](https://js-sdsl.org)                                                                 |
| @lukeed/ms                            | 2.0.2               | [Project page](https://github.com/lukeed/ms#readme)                                                 |
| @napi-rs/canvas                       | 1.0.10              | [Project page](https://github.com/Brooooooklyn/canvas#readme)                                       |
| @napi-rs/canvas-platform-binary       | 1.0.10              | [Project page](https://github.com/Brooooooklyn/canvas#readme)                                       |
| @next/env                             | 16.3.8              | [Project page](https://github.com/vercel/next.js#readme)                                            |
| @next/swc-platform-binary             | 16.3.8              | [Project page](https://github.com/vercel/next.js#readme)                                            |
| @noble/hashes                         | 2.4.0               | [Project page](https://paulmillr.com/noble/)                                                        |
| @nodable/entities                     | 3.1.0               | [Project page](https://github.com/nodable/val-parsers#readme)                                       |
| @pinojs/redact                        | 0.4.0               | [Project page](https://github.com/pinojs/redact#readme)                                             |
| @socket.io/component-emitter          | 3.1.2               | [Project page](https://github.com/socketio/emitter#readme)                                          |
| @socket.io/redis-streams-adapter      | 0.3.1               | [Project page](https://github.com/socketio/socket.io-redis-streams-adapter#readme)                  |
| @types/cors                           | 2.8.19              | [Project page](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/cors)           |
| @types/node                           | 26.5.1, 26.6.3      | [Project page](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node)           |
| @types/ws                             | 8.18.2              | [Project page](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/ws)             |
| abstract-logging                      | 2.0.1               | [Project page](https://github.com/jsumners/abstract-logging#readme)                                 |
| accepts                               | 1.3.8               | [Project page](https://github.com/jshttp/accepts#readme)                                            |
| ajv                                   | 8.20.0              | [Project page](https://ajv.js.org)                                                                  |
| ajv-formats                           | 3.0.1               | [Project page](https://github.com/ajv-validator/ajv-formats#readme)                                 |
| ansi-regex                            | 5.0.1               | [Project page](https://github.com/chalk/ansi-regex#readme)                                          |
| ansi-styles                           | 4.3.0               | [Project page](https://github.com/chalk/ansi-styles#readme)                                         |
| anynum                                | 1.0.1               | [Project page](https://github.com/NaturalIntelligence/anynum#readme)                                |
| atomic-sleep                          | 1.0.0               | [Project page](https://github.com/davidmarkclements/atomic-sleep#readme)                            |
| avvio                                 | 9.3.0               | [Project page](https://github.com/fastify/avvio#readme)                                             |
| balanced-match                        | 4.0.4               | [Project page](https://github.com/juliangruber/balanced-match#readme)                               |
| bintrees                              | 1.0.2               | [Project page](https://github.com/vadimg/js_bintrees#readme)                                        |
| bowser                                | 2.14.1              | [Project page](https://github.com/bowser-js/bowser)                                                 |
| brace-expansion                       | 5.0.12              | [Project page](https://github.com/juliangruber/brace-expansion#readme)                              |
| buffer-crc32                          | 1.0.0               | [Project page](https://github.com/brianloveswords/buffer-crc32)                                     |
| bytes                                 | 3.1.2               | [Project page](https://github.com/visionmedia/bytes.js#readme)                                      |
| cjs-module-lexer                      | 2.2.1               | [Project page](https://github.com/nodejs/cjs-module-lexer#readme)                                   |
| client-only                           | 0.0.1               | [Project page](https://reactjs.org/)                                                                |
| color-convert                         | 2.0.1               | [Project page](https://github.com/Qix-/color-convert#readme)                                        |
| color-name                            | 1.1.4               | [Project page](https://github.com/colorjs/color-name)                                               |
| cookie                                | 0.7.2, 1.1.1, 2.0.1 | [Project page](https://github.com/jshttp/cookie#readme)                                             |
| cors                                  | 2.8.6               | [Project page](https://github.com/expressjs/cors#readme)                                            |
| dayjs                                 | 1.11.23             | [Project page](https://day.js.org)                                                                  |
| debug                                 | 4.3.7, 4.4.3        | [Project page](https://github.com/debug-js/debug#readme)                                            |
| deepmerge                             | 4.3.1               | [Project page](https://github.com/TehShrike/deepmerge)                                              |
| depd                                  | 2.0.0               | [Project page](https://github.com/dougwilson/nodejs-depd#readme)                                    |
| dequal                                | 2.0.3               | [Project page](https://github.com/lukeed/dequal#readme)                                             |
| dom-serializer                        | 3.1.1               | [Project page](https://github.com/cheeriojs/dom-serializer#readme)                                  |
| emoji-regex                           | 8.0.0               | [Project page](https://mths.be/emoji-regex)                                                         |
| engine.io                             | 6.6.11              | [Project page](https://github.com/socketio/socket.io/tree/main/packages/engine.io#readme)           |
| engine.io-client                      | 6.6.7               | [Project page](https://github.com/socketio/socket.io/tree/main/packages/engine.io-client#readme)    |
| engine.io-parser                      | 5.2.3               | [Project page](https://github.com/socketio/socket.io/tree/main/packages/engine.io-parser#readme)    |
| es-module-lexer                       | 3.0.2               | [Project page](https://github.com/guybedford/es-module-lexer#readme)                                |
| escalade                              | 3.2.0               | [Project page](https://github.com/lukeed/escalade#readme)                                           |
| escape-string-regexp                  | 4.0.0               | [Project page](https://github.com/sindresorhus/escape-string-regexp#readme)                         |
| fast-decode-uri-component             | 1.0.1               | [Project page](https://github.com/delvedor/fast-decode-uri-component#readme)                        |
| fast-deep-equal                       | 3.1.3               | [Project page](https://github.com/epoberezkin/fast-deep-equal#readme)                               |
| fast-json-stringify                   | 7.0.1               | [Project page](https://github.com/fastify/fast-json-stringify#readme)                               |
| fast-querystring                      | 1.1.2               | [Project page](https://github.com/anonrig/fast-querystring#readme)                                  |
| fast-xml-builder                      | 1.3.1               | [Project page](https://github.com/NaturalIntelligence/fast-xml-builder#readme)                      |
| fast-xml-parser                       | 5.11.2              | [Project page](https://github.com/NaturalIntelligence/fast-xml-parser#readme)                       |
| fastify                               | 5.12.5              | [Project page](https://fastify.dev/)                                                                |
| fastify-plugin                        | 6.0.0               | [Project page](https://github.com/fastify/fastify-plugin#readme)                                    |
| fastify-raw-body                      | 6.0.1               | [Project page](https://github.com/Eomm/fastify-raw-body#readme)                                     |
| find-my-way                           | 9.9.0               | [Project page](https://github.com/delvedor/find-my-way#readme)                                      |
| forwarded-parse                       | 2.1.2               | [Project page](https://github.com/lpinca/forwarded-parse)                                           |
| helmet                                | 8.3.0               | [Project page](https://helmet.js.org/)                                                              |
| htmlparser2                           | 12.0.0              | [Project page](https://github.com/fb55/htmlparser2#readme)                                          |
| http-errors                           | 2.0.1               | [Project page](https://github.com/jshttp/http-errors#readme)                                        |
| iconv-lite                            | 0.7.3               | [Project page](https://github.com/pillarjs/iconv-lite)                                              |
| ioredis                               | 6.0.0               | [Project page](https://github.com/redis/ioredis#readme)                                             |
| ip-address                            | 10.7.2              | [Project page](https://github.com/beaugunderson/ip-address#readme)                                  |
| ipaddr.js                             | 2.5.0               | [Project page](https://github.com/whitequark/ipaddr.js#readme)                                      |
| is-fullwidth-code-point               | 3.0.0               | [Project page](https://github.com/sindresorhus/is-fullwidth-code-point#readme)                      |
| is-plain-object                       | 5.1.0               | [Project page](https://github.com/jonschlinkert/is-plain-object)                                    |
| is-unsafe                             | 2.0.2               | [Project page](https://github.com/NaturalIntelligence/is-unsafe#readme)                             |
| jose                                  | 6.2.12              | [Project page](https://github.com/panva/jose)                                                       |
| json-schema-ref-resolver              | 3.0.0               | [Project page](https://github.com/fastify/json-schema-ref-resolver#readme)                          |
| json-schema-traverse                  | 1.0.0               | [Project page](https://github.com/epoberezkin/json-schema-traverse#readme)                          |
| launder                               | 1.7.2               | [Project page](https://github.com/apostrophecms/apostrophe/tree/main/packages/launder#readme)       |
| lodash.camelcase                      | 4.3.0               | [Project page](https://lodash.com/)                                                                 |
| mime-db                               | 1.52.0              | [Project page](https://github.com/jshttp/mime-db#readme)                                            |
| mime-types                            | 2.1.35              | [Project page](https://github.com/jshttp/mime-types#readme)                                         |
| module-details-from-path              | 1.0.4               | [Project page](https://github.com/watson/module-details-from-path#readme)                           |
| ms                                    | 2.1.3               | [Project page](https://github.com/vercel/ms#readme)                                                 |
| nanoid                                | 3.3.19              | [Project page](https://github.com/ai/nanoid#readme)                                                 |
| negotiator                            | 0.6.3               | [Project page](https://github.com/jshttp/negotiator#readme)                                         |
| next                                  | 16.3.8              | [Project page](https://nextjs.org)                                                                  |
| oauth4webapi                          | 3.8.8               | [Project page](https://github.com/panva/oauth4webapi)                                               |
| object-assign                         | 4.1.1               | [Project page](https://github.com/sindresorhus/object-assign#readme)                                |
| on-exit-leak-free                     | 2.1.2               | [Project page](https://github.com/mcollina/on-exit-or-gc#readme)                                    |
| openid-client                         | 6.8.8               | [Project page](https://github.com/panva/openid-client)                                              |
| parse-srcset                          | 1.0.2               | [Project page](https://github.com/albell/parse-srcset#readme)                                       |
| path-expression-matcher               | 1.6.2               | [Project page](https://github.com/NaturalIntelligence/path-expression-matcher#readme)               |
| pend                                  | 1.2.0               | [Project page](https://github.com/andrewrk/node-pend#readme)                                        |
| pg                                    | 8.23.1              | [Project page](https://github.com/brianc/node-postgres)                                             |
| pg-cloudflare                         | 1.4.1               | [Project page](https://github.com/brianc/node-postgres#readme)                                      |
| pg-connection-string                  | 2.14.1              | [Project page](https://github.com/brianc/node-postgres/tree/master/packages/pg-connection-string)   |
| pg-pool                               | 3.14.0              | [Project page](https://github.com/brianc/node-postgres/tree/master/packages/pg-pool#readme)         |
| pg-protocol                           | 1.16.1              | [Project page](https://github.com/brianc/node-postgres#readme)                                      |
| pg-types                              | 2.2.0               | [Project page](https://github.com/brianc/node-pg-types)                                             |
| pgpass                                | 1.0.5               | [Project page](https://github.com/hoegaarden/pgpass#readme)                                         |
| pino                                  | 10.4.0              | [Project page](https://getpino.io)                                                                  |
| pino-abstract-transport               | 3.0.0               | [Project page](https://github.com/pinojs/pino-abstract-transport#readme)                            |
| pino-std-serializers                  | 7.1.0               | [Project page](https://github.com/pinojs/pino-std-serializers#readme)                               |
| postcss                               | 8.5.23, 8.5.28      | [Project page](https://postcss.org/)                                                                |
| postgres-array                        | 2.0.0               | [Project page](https://github.com/bendrucker/postgres-array#readme)                                 |
| postgres-bytea                        | 1.0.1               | [Project page](https://github.com/bendrucker/postgres-bytea#readme)                                 |
| postgres-date                         | 1.0.7               | [Project page](https://github.com/bendrucker/postgres-date#readme)                                  |
| postgres-interval                     | 1.2.0               | [Project page](https://github.com/bendrucker/postgres-interval#readme)                              |
| process-warning                       | 4.0.1, 5.1.0        | [Project page](https://github.com/fastify/fastify-warning#readme)                                   |
| quick-format-unescaped                | 4.0.4               | [Project page](https://github.com/davidmarkclements/quick-format#readme)                            |
| raw-body                              | 3.0.2               | [Project page](https://github.com/stream-utils/raw-body#readme)                                     |
| react                                 | 19.3.0              | [Project page](https://react.dev/)                                                                  |
| react-dom                             | 19.3.0              | [Project page](https://react.dev/)                                                                  |
| real-require                          | 1.0.0               | [Project page](https://github.com/pinojs/real-require)                                              |
| redis-errors                          | 1.2.0               | [Project page](https://github.com/NodeRedis/redis-errors#readme)                                    |
| require-directory                     | 2.1.1               | [Project page](https://github.com/troygoode/node-require-directory/)                                |
| require-from-string                   | 2.0.2               | [Project page](https://github.com/floatdrop/require-from-string#readme)                             |
| require-in-the-middle                 | 8.0.1               | [Project page](https://github.com/nodejs/require-in-the-middle#readme)                              |
| ret                                   | 0.5.0               | [Project page](https://github.com/fent/ret.js#readme)                                               |
| reusify                               | 1.1.0               | [Project page](https://github.com/mcollina/reusify#readme)                                          |
| rfdc                                  | 1.4.1               | [Project page](https://github.com/davidmarkclements/rfdc#readme)                                    |
| safe-regex2                           | 5.1.1               | [Project page](https://github.com/fastify/safe-regex2)                                              |
| safe-stable-stringify                 | 2.5.0               | [Project page](https://github.com/BridgeAR/safe-stable-stringify#readme)                            |
| safer-buffer                          | 2.1.2               | [Project page](https://github.com/ChALkeR/safer-buffer#readme)                                      |
| sanitize-html                         | 2.18.0              | [Project page](https://github.com/apostrophecms/apostrophe/tree/main/packages/sanitize-html#readme) |
| scheduler                             | 0.28.0              | [Project page](https://react.dev/)                                                                  |
| server-only                           | 0.0.1               | [Project page](https://reactjs.org/)                                                                |
| set-cookie-parser                     | 2.7.2               | [Project page](https://github.com/nfriedly/set-cookie-parser)                                       |
| socket.io                             | 4.8.4               | [Project page](https://github.com/socketio/socket.io/tree/main/packages/socket.io#readme)           |
| socket.io-adapter                     | 2.5.8               | [Project page](https://github.com/socketio/socket.io/tree/main/packages/socket.io-adapter#readme)   |
| socket.io-client                      | 4.8.4               | [Project page](https://github.com/socketio/socket.io/tree/main/packages/socket.io-client#readme)    |
| socket.io-parser                      | 4.2.7               | [Project page](https://github.com/socketio/socket.io/tree/main/packages/socket.io-client#readme)    |
| sonic-boom                            | 4.2.1               | [Project page](https://github.com/pinojs/sonic-boom#readme)                                         |
| standard-as-callback                  | 2.1.0               | [Project page](https://github.com/luin/asCallback#readme)                                           |
| statuses                              | 2.0.2               | [Project page](https://github.com/jshttp/statuses#readme)                                           |
| string-width                          | 4.2.3               | [Project page](https://github.com/sindresorhus/string-width#readme)                                 |
| strip-ansi                            | 6.0.1               | [Project page](https://github.com/chalk/strip-ansi#readme)                                          |
| stripe                                | 22.6.2              | [Project page](https://github.com/stripe/stripe-node)                                               |
| strnum                                | 2.4.2               | [Project page](https://github.com/NaturalIntelligence/strnum#readme)                                |
| styled-jsx                            | 5.1.6               | [Project page](https://github.com/vercel/styled-jsx#readme)                                         |
| tdigest                               | 0.1.3               | [Project page](https://github.com/welch/tdigest)                                                    |
| thread-stream                         | 4.2.0               | [Project page](https://github.com/mcollina/thread-stream#readme)                                    |
| toad-cache                            | 3.7.4               | [Project page](https://github.com/kibertoad/toad-cache)                                             |
| toidentifier                          | 1.0.1               | [Project page](https://github.com/component/toidentifier#readme)                                    |
| undici-types                          | 8.9.0               | [Project page](https://undici.nodejs.org)                                                           |
| unpipe                                | 1.0.0               | [Project page](https://github.com/stream-utils/unpipe#readme)                                       |
| vary                                  | 1.1.2               | [Project page](https://github.com/jshttp/vary#readme)                                               |
| wrap-ansi                             | 7.0.0               | [Project page](https://github.com/chalk/wrap-ansi#readme)                                           |
| ws                                    | 8.21.3              | [Project page](https://github.com/websockets/ws)                                                    |
| xml-naming                            | 0.3.0               | [Project page](https://github.com/NaturalIntelligence/xml-naming#readme)                            |
| xmlhttprequest-ssl                    | 2.1.2               | [Project page](https://github.com/mjwwit/node-XMLHttpRequest#readme)                                |
| xtend                                 | 4.0.2               | [Project page](https://github.com/Raynos/xtend)                                                     |
| yargs                                 | 17.7.3              | [Project page](https://yargs.js.org/)                                                               |
| yauzl                                 | 3.4.0               | [Project page](https://github.com/thejoshwolfe/yauzl)                                               |
| yazl                                  | 3.3.1               | [Project page](https://github.com/thejoshwolfe/yazl)                                                |
| zod                                   | 4.6.5               | [Project page](https://zod.dev)                                                                     |

### MIT-0

| Package    | Version | Project                                 |
| ---------- | ------- | --------------------------------------- |
| nodemailer | 10.0.14 | [Project page](https://nodemailer.com/) |

## Services in the community Compose profile

These programs run as separate containers and are not relicensed by Polling Pops:

| Service                       | Compose image                                                                                           | License and source                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| PostgreSQL                    | `postgres:17-alpine`                                                                                    | [PostgreSQL License](https://www.postgresql.org/about/licence/)                                      |
| Valkey                        | `valkey/valkey:8-alpine`                                                                                | [BSD 3-Clause](https://github.com/valkey-io/valkey/blob/unstable/COPYING)                            |
| MinIO volume ownership helper | `cgr.dev/chainguard/wolfi-base@sha256:fac38d12efdb4bf43ac9e599a31db10a27ad5dd71e5f1618790962eda8d66180` | [Package licenses and image SBOM](https://images.chainguard.dev/directory/image/wolfi-base/overview) |
| MinIO Server                  | `cgr.dev/chainguard/minio@sha256:bd014394a80898e68c149f2311fdf8d5a2c2f3bb2c33b9327ae6d02b4b065ae1`      | [GNU AGPL v3](https://github.com/minio/minio/blob/master/LICENSE)                                    |
| Mailpit                       | `axllent/mailpit:v1.27`                                                                                 | [MIT](https://github.com/axllent/mailpit/blob/develop/LICENSE)                                       |
| Caddy                         | `caddy:2.10-alpine`                                                                                     | [Apache 2.0](https://github.com/caddyserver/caddy/blob/master/LICENSE)                               |

Operators distributing a composed appliance or modified service image are responsible for
the corresponding license obligations. In particular, MinIO's AGPL terms are separate from
the Apache-2.0 license that applies to Polling Pops’ own source and original bundled assets.

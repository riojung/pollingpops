# AWS's documented Linux-package container path, pinned to v1.0.385 (CC0-1.0).
# https://docs.aws.amazon.com/emulator/latest/userguide/getting-started-docker.html
FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal@sha256:158a9044f9dc0777f098b76c8b54346f6ed4560b9a6a416dec7a5ba3bc483af4 AS base
FROM base AS package-arm64
ADD --checksum=sha256:e2f01620e9f4e8c37c0ce7f32381fde3ffb7e8270331c8c23de2ec877b6a9043 https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator-1.0.385-1-aarch64.rpm /tmp/aws-emulator.rpm
FROM base AS package-amd64
ADD --checksum=sha256:2b2b5031e559d74c7a4154b11056be3a57716a177cd796cf058eebd91a6870d7 https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator-1.0.385-1-x86_64.rpm /tmp/aws-emulator.rpm
ARG TARGETARCH
FROM package-${TARGETARCH} AS runtime
RUN rpm -i /tmp/aws-emulator.rpm && rm /tmp/aws-emulator.rpm \
    && mkdir -p /home/emulator && chown 1000:1000 /home/emulator
USER 1000:1000
ENV HOME=/home/emulator EMULATOR_TELEMETRY=off
EXPOSE 19297
ENTRYPOINT ["aws-emulator", "--bind", "0.0.0.0", "--port", "19297", "--auth", "on", "--telemetry", "off"]

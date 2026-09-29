# Mirrors the upstream GoTrue image into Artifact Registry (Cloud Run cannot
# pull public.ecr.aws directly). BASE_IMAGE comes from build-arg via the
# stage-third-party.yaml substitutions — no registry pinned here.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

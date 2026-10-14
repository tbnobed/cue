# Only the guest signing header is customized. No Pro functionality is enabled.
ARG DOCUSEAL_VERSION=3.2.1
FROM alpine:3.21 AS source
ARG DOCUSEAL_VERSION
# Fail closed on upgrades: review the upstream view before changing this pin.
RUN test "$DOCUSEAL_VERSION" = "3.2.1"
ADD https://github.com/docusealco/docuseal/archive/refs/tags/3.2.1.tar.gz /tmp/upstream.tar.gz
RUN mkdir /source && tar -xzf /tmp/upstream.tar.gz -C /source --strip-components=1
COPY docker/docuseal/_docuseal_logo.html.erb /source/app/views/submit_form/_docuseal_logo.html.erb
COPY docker/docuseal/tbn-logo.png /source/public/cue-branding/tbn-logo.png
COPY docker/docuseal/NOTICE /source/CUE_BRANDING_NOTICE
COPY docker/docuseal/Dockerfile /source/CueBranding.Dockerfile
RUN tar -czf /docuseal-source.tar.gz -C /source .

FROM docuseal/docuseal:${DOCUSEAL_VERSION}
# Refuse an incompatible upstream image rather than break signing silently.
RUN ruby -rdigest -e 'abort "Unexpected DocuSeal signing header; review branding before upgrading" unless Digest::SHA256.file("/app/app/views/submit_form/_docuseal_logo.html.erb").hexdigest == "9e8c2aacba1c3b3d8d3eaea84ad4d7cbad3ebb820c35b1105c9454dc501a78ec"'
COPY docker/docuseal/_docuseal_logo.html.erb /app/app/views/submit_form/_docuseal_logo.html.erb
COPY docker/docuseal/tbn-logo.png /app/public/cue-branding/tbn-logo.png
COPY --from=source /docuseal-source.tar.gz /app/public/cue-branding/docuseal-source.tar.gz
COPY docker/docuseal/NOTICE /app/public/cue-branding/NOTICE.txt

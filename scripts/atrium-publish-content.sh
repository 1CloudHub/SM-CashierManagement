#!/usr/bin/env bash
# Upload the SM Atrium proposal decks to the private Atrium content bucket.
#
# The decks carry SM Retail branding and proposal content, so they are never
# committed to this repository. Build them locally and upload with:
#
#   scripts/atrium-publish-content.sh <proposal.html> <exec-summary.html>
#
# Needs AWS credentials for the LaneWise account (same as `cdk deploy`).
# Signed-in Atrium users then read them through the content API.
set -euo pipefail

STACK="${ATRIUM_STACK_NAME:-LaneWise-prod-Atrium}"
PROPOSAL="${1:?usage: $0 <proposal.html> <exec-summary.html>}"
EXEC="${2:?usage: $0 <proposal.html> <exec-summary.html>}"

for f in "$PROPOSAL" "$EXEC"; do
  [ -f "$f" ] || { echo "not found: $f" >&2; exit 1; }
done

BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='AtriumContentBucketName'].OutputValue" --output text)
[ -n "$BUCKET" ] && [ "$BUCKET" != "None" ] || { echo "no AtriumContentBucketName output on $STACK" >&2; exit 1; }

# Keys match ATRIUM_CONTENT in infra/lib/atrium-stack.ts.
aws s3 cp "$PROPOSAL" "s3://$BUCKET/content/sm-atrium-proposal.html" --content-type "text/html; charset=utf-8"
aws s3 cp "$EXEC" "s3://$BUCKET/content/sm-atrium-exec-summary.html" --content-type "text/html; charset=utf-8"
echo "Uploaded to s3://$BUCKET/content/"

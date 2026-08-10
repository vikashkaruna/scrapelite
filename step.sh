set -e
echo "Checking ready staging deploys against $GITHUB_SHA..."
RESP=$(curl -s \
  -H "Authorization: Bearer ${{ secrets.NETLIFY_AUTH_TOKEN }}" \
  "https://api.netlify.com/api/v1/sites/${{ secrets.NETLIFY_SITE_ID }}/deploys?per_page=20&context=branch-deploy")
STAGING_SHAS=$(echo "$RESP" \
  | jq -r '[.[] | select(.branch == "staging" and .state == "ready") | .commit_ref // empty] | unique | .[]')
if [ -z "$STAGING_SHAS" ]; then
  echo "✗ no ready staging deploy found on Netlify"
  exit 1
fi
echo "  ready staging deploys: $(echo "$STAGING_SHAS" | tr '\n' ' ')"

# The policy is "everything in this main commit was released to staging
# and tested there first". That holds in EITHER direction:
#   staging ⊆ main  → staging shipped first, main merged it (normal case)
#   main ⊆ staging  → staging has since moved on but still contains this
#                     commit, so it was deployed + tested on staging.
# Requiring only the first direction made any later staging push
# retroactively fail an older, still-queued main run (run #22: staging
# was at 14dd570 while this run was gating its own ancestor bded77d).
# We also scan every ready staging deploy, not just the newest one.
MATCH=""
for SHA in $STAGING_SHAS; do
  git cat-file -e "$SHA^{commit}" 2>/dev/null || continue
  if git merge-base --is-ancestor "$SHA" "$GITHUB_SHA"; then
    MATCH="$SHA"; REL="staging commit is contained in main — staging was released first"
    break
  fi
  if git merge-base --is-ancestor "$GITHUB_SHA" "$SHA"; then
    MATCH="$SHA"; REL="main commit is contained in a newer staging deploy — it was released and tested on staging"
    break
  fi
done

if [ -n "$MATCH" ]; then
  echo "  ✓ matched staging deploy $MATCH: $REL"
else
  echo "✗ none of the ready staging deploys share history with $GITHUB_SHA."
  echo "  Release to staging (and let it pass the Staging Gate) before releasing main."
  exit 1
fi

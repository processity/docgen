#!/bin/bash

# Copy Salesforce secrets from .env to CI environment

set -e

REPO="bigmantra/docgen"
ENV="ci"

echo "Copying Salesforce secrets to CI environment..."
echo ""

if [ -f .env ]; then
  echo "Found .env file. Reading Salesforce credentials..."
  source .env

  if [ -n "$SF_PRIVATE_KEY" ]; then
    echo -n "Setting CI_SF_PRIVATE_KEY... "
    echo "$SF_PRIVATE_KEY" | gh secret set CI_SF_PRIVATE_KEY --env "$ENV" -R "$REPO" && echo "✓"
    echo -n "Setting SF_PRIVATE_KEY... "
    echo "$SF_PRIVATE_KEY" | gh secret set SF_PRIVATE_KEY --env "$ENV" -R "$REPO" && echo "✓"
  else
    echo "⚠ SF_PRIVATE_KEY not found in .env"
  fi

  if [ -n "$SF_CLIENT_ID" ]; then
    echo -n "Setting CI_SF_CLIENT_ID... "
    echo "$SF_CLIENT_ID" | gh secret set CI_SF_CLIENT_ID --env "$ENV" -R "$REPO" && echo "✓"
    echo -n "Setting SF_CLIENT_ID... "
    echo "$SF_CLIENT_ID" | gh secret set SF_CLIENT_ID --env "$ENV" -R "$REPO" && echo "✓"
  else
    echo "⚠ SF_CLIENT_ID not found in .env"
  fi

  if [ -n "$SF_USERNAME" ]; then
    echo -n "Setting CI_SF_USERNAME... "
    echo "$SF_USERNAME" | gh secret set CI_SF_USERNAME --env "$ENV" -R "$REPO" && echo "✓"
  else
    echo "⚠ SF_USERNAME not found in .env"
  fi

  echo ""
  echo "✅ Salesforce secrets copied from .env to CI environment!"
else
  echo "⚠ .env file not found"
  echo ""
  echo "Please set Salesforce secrets manually:"
  echo "  gh secret set CI_SF_PRIVATE_KEY --env $ENV -R $REPO"
  echo "  gh secret set CI_SF_CLIENT_ID --env $ENV -R $REPO"
  echo "  gh secret set CI_SF_USERNAME --env $ENV -R $REPO"
  echo "  gh secret set SF_PRIVATE_KEY --env $ENV -R $REPO"
  echo "  gh secret set SF_CLIENT_ID --env $ENV -R $REPO"
fi

#!/bin/bash

# Script to run Salesforce JWT integration tests

# Check if configuration files exist
if [ ! -f .env ]; then
    echo "⚠️  .env file not found - integration tests may skip"
fi

if [ ! -f ./keys/server.key ]; then
    echo "⚠️  Private key not found at ./keys/server.key"
fi

# Load .env file if it exists
if [ -f .env ]; then
    source .env
fi

# Run the integration tests
npm run test:integration
#!/bin/bash
# Install the updated TradeX.app into /Applications, replacing the old version.
# Requires admin privileges (sudo).

# Step 1: Ensure the app is not running
# (optional – you can quit it manually if it’s open)

# Step 2: Remove the old bundle (ignore errors if it does not exist)
sudo rm -rf /Applications/TradeX.app || true

# Step 3: Copy the new bundle
sudo cp -R "$(pwd)/TradeX_unpacked/TradeX.app" /Applications/

# Step 4: Verify the copy
ls -l /Applications/TradeX.app

# Step 5: Launch the app (optional)
# open -a /Applications/TradeX.app

echo "TradeX has been installed/updated. You can now run 'open -a /Applications/TradeX.app' to start it."

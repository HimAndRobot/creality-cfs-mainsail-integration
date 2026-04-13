#!/bin/zsh
set -euo pipefail

export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="/opt/homebrew/share/android-commandlinetools"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="/opt/homebrew/opt/openjdk@21/bin:$ANDROID_HOME/cmdline-tools/latest/bin:/opt/homebrew/bin:$PATH"

cd "$(dirname "$0")/android"
./gradlew assembleRelease

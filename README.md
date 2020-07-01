# Sylk React Native Client

This repo is based off of Sylk-WebRTC - a repo housing a web app and the Electron app for Desktop.

## Getting Started

### Dependencies

* Node.js version 12
* Yarn (for package management)
* GPG (for git-crypt)
* Git-Crypt (for keeping a google upload key keystore secret)
* XCode
* Android Studio (Or at least the Android SDK)
* Gem (for installing gem files)
* Fastlane (for deploying to testflight/google play store)
* Cocoapods (for handling iOS Pods)
* watchman (for helping watch files during development)

### Install

Follow the [Getting Started guide](https://facebook.github.io/react-native/docs/getting-started) as much as you can but not everything will be explained. No install docs will be listed here for each tool as they'll change, go and check them out yourself.

### Updating the app

Yarn can be a bit of a pain, especially when a git dependency changes

To be sure you're running the lastest code run:

```bash
rm -rf node_modules
rm -rf ios/Pods
yarn cache clean
yarn
cd ios; pod install; cd ..
```

### Decrypting the git repo

Run `git-crypt unlock` to check that you can decrypt the files in the repo. If you can't you'll need to generate a GPG key and pass it to someone with access to the repo. A good guide is located at https://medium.com/@sumitkum/securing-your-secret-keys-with-git-crypt-b2fa6ffed1a6

## Running the app

Use `react-native run-ios --help` and `react-native run-android --help` to give you all you need to know. You shouldn't ever have to build from Xcode or Android Studio.

### Running on the iOS Simulator

Currently we have issues running a build of ios from the cli using `yarn react-native run-ios` so instead, open up xcode and run it there

```bash
open ios/sylk.xcworkspace/
```

### Running on the Android Simulator or device

If you don't have any simulators running, and don't have an android device plugged in (or available to adb) React Native will start up a simulator for you. If you have a device available (doesn't matter if its real or a simulator) this command will output to the device.

```bash
yarn react-native run-android
```

### Debugging

Install https://reactnative.dev/docs/debugging#react-developer-tools

Shake the device and touch Debug.


### Running on the iOS Device

Currently we have issues running a build of ios from the cli using `yarn react-native run-ios --device` so instead, open up xcode and run it there

### Running on a specific Android Device

```bash
yarn react-native run-android --deviceId "DeviceId"
```

>   --deviceId [string] builds your app and starts it on a specific device/simulator with the given device id (listed by running "adb devices" on the command line).


## Clean the project

You might want to bring the project back to a clean repo if you're hitting any issues.

Try it as a dry-run first

```bash
git clean -d -x --dry-run
```

```bash
git clean -d -x -f
```

## Building the app for deployment

We use `fastlane` for building production versions of the app.

Fastlane can handle all the metadata around your entry into the relevant App Stores and much much more too.

Currently we have two commands - you will need to open Xcode and allow it to sync the deployment key as we allow Xcode to control that rather than do it ourselves. We could add it directly into the project with git-crypt and tell fastlane to use it to make this easier.

```bash
fastlane ios beta
```

```bash
fastlane android beta
```
# Sylk Mobile

Sylk Mobile is part of Sylk Suite, a set of real-time communications
applications using IETF SIP protocol and WebRTC specifications.  

Sylk Suite consists of:

* SIP/WebRTC application server
* Mobile push notifications server
* Desktop clients for Windows, Linux and MacOS
* Mobile clients for Apple iOS and Google Android
* Web page for WebRTC enabled browsers
* Mobile client development SDK
* Desktop client development SDK

[Home page](https://sylkserver.com)


## License

Sylk mobile licensed under GNU General Public License version 3.  A copy of
the license is available at http://www.fsf.org/licensing/licenses/gpl-3.0.html

Copyright 2020 [AG Projects](https://ag-projects.com)


## Availability

* [Google Play](https://play.google.com/store/apps/details?id=com.agprojects.sylk)
* [Apple Store](https://apps.apple.com/us/app/id1489960733)
* Source code


## Features

* 1-to-1 audio and video calls
* Text messaging
* Multiparty video conferencing
* Call history entries management
* Native address book lookup
* Wake up from sleep
* Native OS telephony integration
* Deep links OS integration
* Support for multiple cameras
* Support for landscape and portrait modes
* Support for tablet and phone sizes
* Supports CallKeep for iOS >=13
* Supports Telecom connection service for Android
* Interoperable with SIP clients


## Credits

### Financial support

* NGI0 PET Fund, a fund established by NLnet with financial support from the European Commission's Next Generation Internet programme, under the aegis of DG Communications Networks, Content and Technology under grant agreement No 825310
* [Project description](https://nlnet.nl/project/SylkMobile/)



### People

* Saúl Ibarra Corretgé - Inception architect / original idea
* Tijmen de Mes - API, Conference and desktop
* Dan Jenkins - WebRTC and React Native mechanic
* Adrian Georgescu - Janitor
* Bibiana Rivadeneira - Push notifications
* Michiel Leenaars - Strategic guidance


## Running dependencies

* Sylk Server
* Sylk Pushserver
* SIP infra with push notifications support

## Demo client


* [OpenSIPS](https://opensips.org) server software 
* [SIP2SIP](https://sip2sip.info) public infrastructure
* [Janus](https://github.com/meetecho/janus-gateway) Gateway


## Getting Started

### Building ependencies

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

Follow the [Getting Started
guide](https://facebook.github.io/react-native/docs/getting-started) as much
as you can but not everything will be explained.  No install docs will be
listed here for each tool as they'll change, go and check them out yourself.

### Updating the app

Yarn can be a bit of a pain, especially when a git dependency changes.

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

### Running the app

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


### Running without debugging
 
To run the app on your device without tethering it to USB:

On Android:

```bash
yarn react-native run-android --variant=release

``` 
On iOS:

Select menu Product -> Scheme -> Edit scheme andselect for Run Build Configuration = Release

Beware that iOS push tokens are still meant for sandbox unless the app is
released through Apple Store.

### Clean the project

You might want to bring the project back to a clean repo if you're hitting any issues.

Try it as a dry-run first

```bash
git clean -d -x --dry-run
```

```bash
git clean -d -x -f
```

### Building the app for deployment

We use `fastlane` for building production versions of the app.

Fastlane can handle all the metadata around your entry into the relevant App Stores and much much more too.

Currently we have two commands - you will need to open Xcode and allow it to sync the deployment key as we allow Xcode to control that rather than do it ourselves. We could add it directly into the project with git-crypt and tell fastlane to use it to make this easier.

```bash
fastlane ios beta
```

```bash
fastlane android beta
```

### Patches

We utilise the [patch-package](https://www.npmjs.com/package/patch-package) module in order to patch the `react-native-callkeep` module instead of maintaining a complete fork. See their README on how to make changes to the patch and how those patches get installed automatically within this project on install of npm modules.

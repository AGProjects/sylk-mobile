# Sylk Mobile

Sylk Mobile is part of Sylk Suite, a set of real-time communications
applications using IETF SIP protocol and WebRTC specifications.  

Sylk Suite consists of:

* Sylk SIP/WebRTC application server
* Sylk mobile push notifications server
* Sylk desktop client for Windows, Linux and MacOS
* Sylk mobile client for Apple iOS and Google Android
* Web page for WebRTC enabled browsers
* Mobile client API development SDK
* Desktop client API development SDK

[Home page](https://sylkserver.com)


## License

Sylk mobile licensed under GNU General Public License version 3.  A copy of
the license is available at http://www.fsf.org/licensing/licenses/gpl-3.0.html

Copyright 2022 [AG Projects](https://ag-projects.com)


## Availability

* [SIP2SIP Web page](https://sip2sip.info)
* [Google Play Store](https://play.google.com/store/apps/details?id=com.agprojects.sylk)
* [Apple Store](https://apps.apple.com/us/app/id1489960733)
* [Beta versions](https://sylkserver.com)
* [Source code](https://github.com/AGProjects/sylk-mobile)


## Features

* 1-to-1 audio and video calls
* Encrypted end-to-end messaging
* Encrypted end-to-end file transfers
* Synchronization of multiple devices 
* Multiparty conferencing for all supported media
* Call history entries management
* Native address book lookup
* Native OS telephony integration
* Support for multiple devices in parallel
* Support for multiple cameras
* Support for landscape and portrait modes
* Support for tablets and phones
* Interoperable with SIP clients
* Receive calls from the web
* Support for Self Sovereign Identity (SSI)

Messages are encrypted end-to-end using OpenPGP.  

File transfer are encrypted end-to-end using OpenPGP whenever possible.

SSI support is based on Hyperledger provided by Indy and Animo SDKs.


## Credits

### Financial support from:

* NGI0 PET Fund, a fund established by NLnet with financial support from the European Commission's Next Generation Internet programme, under the aegis of DG Communications Networks, Content and Technology under grant agreement [No 825310](https://nlnet.nl/project/SylkMobile/)
* NGI eSSIF-Lab program, in collaboration with [Bloqzone](https://bloqzone.com) [ADDING SSI TO INTERNET COMMS USING SYLK SUITE](https://www.ngi.eu/funded_solution/essi_ioc_44/)

### People

* Adrian Georgescu - Project lead
* Saúl Ibarra Corretgé - Inception architect / original idea
* Tijmen de Mes - API, Conference, Chat and desktop features
* Dan Jenkins - WebRTC and React Native mechanic
* Michiel Leenaars - Strategic guidance
* Alexander Blom - SSIcomms partnership
* Karim Stekelenburg - Animo SDK integration


## Running dependencies

* Generic SIP infrastructure


## Developing dependencies

* [Janus](https://github.com/meetecho/janus-gateway) Gateway
* [Animo SDK for SSI support](https://github.com/animo/aries-mobile-sdk)


## Getting Started

### Building dependencies

* Java from http://java.com
* NVM from https://heynode.com/tutorial/install-nodejs-locally-nvm/
* Using nvm install Node.js version 12
* Yarn (for package management)
  curl -o- -L https://yarnpkg.com/install.sh | bash 
* XCode
* Android Studio (Or at least the Android SDK)
  export JAVA_HOME="/Library/Internet\ Plug-Ins/JavaAppletPlugin.plugin/Contents/Home"
  export PATH=$JAVA_HOME/bin:$PATH
  export ANDROID_SDK_ROOT=/Users/example/Library/Android/sdk

  On Mac Copy tools.jar to the following location:
  sudo cp /Applications/Android\ Studio.app/Contents/jre/jdk/Contents/Home/lib/tools.jar \
  /Library/Internet\ Plug-Ins/JavaAppletPlugin.plugin/Contents/Home/lib/

* Gem (for installing gem files)
* Fastlane (for deploying to testflight/google play store)
* Cocoapods (for handling iOS Pods) 
  - Install RVM: curl -L https://get.rvm.io | bash -s stable
  - Update ruby: rvm install rvm install ruby
  - Add to .bash_profile
    export LANG=en_US.UTF-8
    export LANGUAGE=en_US.UTF-8
    export LC_ALL=en_US.UTF-8
  - sudo gem install cocoapods
* watchman (for helping watch files during development)
  brew install watchman or port install watchman
* Hyperledger Indy SDK from https://github.com/hyperledger/indy-sdk

  Download libindy libraries from https://repo.sovrin.org/android/libindy/main/

  https://repo.sovrin.org/android/libindy/main/1.16.0-1/libindy_android_arm64_1.16.0.zip
  https://repo.sovrin.org/android/libindy/main/1.16.0-1/libindy_android_arm_1.16.0.zip
  https://repo.sovrin.org/android/libindy/main/1.16.0-1/libindy_android_armv7_1.16.0.zip
  https://repo.sovrin.org/android/libindy/main/1.16.0-1/libindy_android_x86_1.16.0.zip
  https://repo.sovrin.org/android/libindy/main/1.16.0-1/libindy_android_x86_64_1.16.0.zip

  To ./android/app/src/main/jniLibs$


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
rm -r android/app/build
yarn cache clean
yarn
rm -rf ios/Pods
rm Podfile.lock
rm -r ~/.cocoapods
cd ios; pod setup; pod install; cd ..
```

You might want to bring the project back to a clean repo if you're hitting any issues.

Try it as a dry-run first

```bash
git clean -d -x --dry-run
```

```bash
git clean -d -x -f
```

### XCODE 12.5 fixes

1. https://infinitbility.com/build-failed-after-update-xcode-12.5

2. https://github.com/foundation/foundation-cli/issues/98

npm rebuild node-sass

3. https://github.com/facebook/create-react-app/issues/4540

brew install watchman or port install watchman

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

To see the logs of the attached Android device:

adb logcat '*:W'.


### Debugging

Install https://reactnative.dev/docs/debugging#react-developer-tools

Shake the device and touch Debug.

In XCode enable debugger:

Product -> Scheme -> Edit -> Run -> Build Configuration -> Debug


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

### Update sylkrts.js

yarn add -D AGProjects/sylkrtc.js

### Firebase notifications reference

https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages#AndroidNotification


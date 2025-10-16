fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios beta

```sh
[bundle exec] fastlane ios beta
```

Push a new beta build to TestFlight

### ios install_release

```sh
[bundle exec] fastlane ios install_release
```

Build and install release version on connected device

### ios upload_testflight

```sh
[bundle exec] fastlane ios upload_testflight
```

Build and upload release version to TestFlight

----


## Android

### android beta

```sh
[bundle exec] fastlane android beta
```

Push a new beta build to Google Play Store

### android release

```sh
[bundle exec] fastlane android release
```

Push a new beta build to Google Play Store

### android build_aab

```sh
[bundle exec] fastlane android build_aab
```

Push a new beta build to Google Play Store

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).

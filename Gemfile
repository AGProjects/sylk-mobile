source "https://rubygems.org"

gem "fastlane"

plugins_path = File.join(File.dirname(__FILE__), 'fastlane', 'Pluginfile')
eval_gemfile(plugins_path) if File.exist?(plugins_path)

gem 'cocoapods', '>= 1.13', '< 1.15'
gem 'activesupport', '>= 6.1.7.5', '< 7.1.0'
gem 'xcodeproj', '< 1.26.0'

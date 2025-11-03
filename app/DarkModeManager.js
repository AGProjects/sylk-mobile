// DarkModeManager.js
import { Appearance } from 'react-native';

class DarkModeManager {
  constructor() {
    this.dark = Appearance.getColorScheme() === 'dark';
    this.listeners = [];

    // Listen to OS theme changes
    this.subscription = Appearance.addChangeListener(({ colorScheme }) => {
      this.dark = colorScheme === 'dark';
      this.notifyListeners();
    });
  }

  setDark(isDark) {
    this.dark = !!isDark;
    this.notifyListeners();
  }

  isDark() {
    return this.dark;
  }

  // For classes to subscribe to changes
  addListener(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
  }

  removeListener(callback) {
    this.listeners = this.listeners.filter(cb => cb !== callback);
  }

  notifyListeners() {
    this.listeners.forEach(cb => cb(this.dark));
  }

  // Cleanup when needed
  cleanup() {
    this.subscription?.remove();
    this.listeners = [];
  }
}

// Export a singleton instance
export default new DarkModeManager();


import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import RegisterForm from './RegisterForm';
import Logo from './Logo';
import styles from '../assets/styles/blink/_RegisterBox.scss';

const RegisterBox = ({
  enrollmentUrl,
  serverSettingsUrl,
  defaultDomain,
  sylkDomain,
  serverIsValid,
  handleSignIn,
  handleEnrollment,
  registrationInProgress,
  showLogo,
  orientation,
  isTablet,
  connected,
  myPhoneNumber,
  lookupSylkServer,
  SylkServerDiscovery,
  SylkServerDiscoveryResult,
  SylkServerStatus,
  resetSylkServerStatus
}) => {

  // ---------------------------------------------
  // 1) Derive state from props (if needed)
  // ---------------------------------------------
  const [isLandscape, setIsLandscape] = useState(orientation === 'landscape');

  useEffect(() => {
    // runs whenever orientation changes
    setIsLandscape(orientation === 'landscape');
  }, [orientation]);


  // ---------------------------------------------
  // 2) Memoize heavy derived values (optional)
  // ---------------------------------------------
  const containerStyle = useMemo(() => {
    if (isTablet) {
      return isLandscape
        ? styles.landscapeTabletRegisterBox
        : styles.portraitTabletRegisterBox;
    }
    return isLandscape
      ? styles.landscapeRegisterBox
      : styles.portraitRegisterBox;
  }, [isTablet, isLandscape]);


  // ---------------------------------------------
  // 3) React to other prop changes (optional)
  // ---------------------------------------------
  useEffect(() => {
    if (serverIsValid === false) {
      console.log('❌ Server became invalid');
    }
  }, [serverIsValid]);

  useEffect(() => {
    if (connected) {
      console.log('📶 Connection restored');
    }
  }, [connected]);


  return (
    <View style={containerStyle}>
      {showLogo && (
        <View>
          <Logo orientation={orientation} isTablet={isTablet} />
        </View>
      )}

      <View>
        <RegisterForm
          enrollmentUrl={enrollmentUrl}
          serverSettingsUrl={serverSettingsUrl}
          defaultDomain={defaultDomain}
          sylkDomain={sylkDomain}
          serverIsValid={serverIsValid}
          registrationInProgress={registrationInProgress}
          handleSignIn={handleSignIn}
          handleEnrollment={handleEnrollment}
          orientation={orientation}
          isTablet={isTablet}
          connected={connected}
          myPhoneNumber={myPhoneNumber}
          lookupSylkServer={lookupSylkServer}
          SylkServerDiscovery={SylkServerDiscovery}
          SylkServerDiscoveryResult={SylkServerDiscoveryResult}
          SylkServerStatus={SylkServerStatus}
          resetSylkServerStatus={resetSylkServerStatus}
        />
      </View>
    </View>
  );
};

export default RegisterBox;


const { execSync } = require('child_process');
const path = require('path');

/**
 * Ad-hoc code signing for macOS to prevent repeated permission dialogs
 *
 * This script runs after electron-builder packages the app.
 * It applies an ad-hoc signature which gives the app a consistent identity
 * so macOS remembers permission grants across app launches.
 */
module.exports = async function(context) {
  // Only run on macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('Skipping ad-hoc signing (not macOS)');
    return;
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log('\n🔐 Applying ad-hoc code signature to prevent permission dialogs...');
  console.log(`   App path: ${appPath}`);

  try {
    // Apply ad-hoc signature with --deep flag to sign all nested components
    execSync(`codesign --force --deep --sign - "${appPath}"`, {
      stdio: 'inherit'
    });

    console.log('✅ Ad-hoc signature applied successfully!');
    console.log('   The app will now maintain permission grants across launches.\n');
  } catch (error) {
    console.error('❌ Failed to apply ad-hoc signature:', error.message);
    console.error('   Users may need to manually sign the app after installation.');
    console.error('   Command: sudo codesign --force --deep --sign - /Applications/Meeting\\ Note\\ Recorder.app\n');
  }
};

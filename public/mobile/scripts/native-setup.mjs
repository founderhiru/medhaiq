// Idempotent post-"cap add" patcher: adds the permissions MedhaIQ needs
// (microphone for live voice interviews, camera for the optional video
// presence check, iPad orientations). Safe to re-run.
import fs from 'node:fs';
import path from 'node:path';

const platform = process.argv[2];
const root = path.resolve(import.meta.dirname, '..');

function patchAndroid() {
  const f = path.join(root, 'android/app/src/main/AndroidManifest.xml');
  let x = fs.readFileSync(f, 'utf8');
  const perms = [
    '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
    '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
    '<uses-permission android:name="android.permission.CAMERA" />',
    '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
    '<uses-feature android:name="android.hardware.microphone" android:required="false" />',
    '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  ];
  for (const p of perms) {
    if (!x.includes(p)) x = x.replace('</manifest>', `    ${p}\n</manifest>`);
  }
  fs.writeFileSync(f, x);
  console.log('Android manifest patched');
}

function patchIos() {
  const f = path.join(root, 'ios/App/App/Info.plist');
  let x = fs.readFileSync(f, 'utf8');
  const add = (key, valueXml) => {
    if (!x.includes(`<key>${key}</key>`)) x = x.replace(/<\/dict>\s*<\/plist>/, `\t<key>${key}</key>\n\t${valueXml}\n</dict>\n</plist>`);
  };
  add('NSMicrophoneUsageDescription', '<string>MedhaIQ uses your microphone so you can answer interview questions out loud.</string>');
  add('NSCameraUsageDescription', '<string>MedhaIQ uses your camera for the optional video presence check during interviews.</string>');
  add('ITSAppUsesNonExemptEncryption', '<false/>');
  const all = '<array><string>UIInterfaceOrientationPortrait</string><string>UIInterfaceOrientationPortraitUpsideDown</string><string>UIInterfaceOrientationLandscapeLeft</string><string>UIInterfaceOrientationLandscapeRight</string></array>';
  if (!x.includes('UISupportedInterfaceOrientations~ipad')) add('UISupportedInterfaceOrientations~ipad', all);
  fs.writeFileSync(f, x);
  console.log('iOS Info.plist patched');
}

if (platform === 'android') patchAndroid();
else if (platform === 'ios') patchIos();
else { console.error('usage: node scripts/native-setup.mjs android|ios'); process.exit(1); }

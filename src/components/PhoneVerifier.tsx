/**
 * Native (iOS/Android) reCAPTCHA verifier for Firebase phone auth with the
 * Firebase JS SDK. Firebase requires a reCAPTCHA token before sending an SMS;
 * we obtain it from a WebView served from your Firebase authDomain. Works in
 * Expo Go and in development/production builds.
 */
import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { firebaseConfig } from '../services/config';
import type { PhoneVerifier } from '../services/backend';
import { colors } from '../theme';

export interface PhoneVerifierHandle {
  getVerifier(): PhoneVerifier;
}

const SDK = '10.14.1';
const html = () => `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://www.gstatic.com/firebasejs/${SDK}/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/${SDK}/firebase-auth-compat.js"></script>
<style>body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif}</style>
</head><body><div id="rc"></div><script>
function post(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
try{
  firebase.initializeApp(${JSON.stringify(firebaseConfig)});
  var v=new firebase.auth.RecaptchaVerifier('rc',{size:'invisible',
    callback:function(t){post({type:'token',token:t});},
    'expired-callback':function(){post({type:'error',message:'reCAPTCHA expired'});}});
  v.verify().then(function(t){post({type:'token',token:t});}).catch(function(e){post({type:'error',message:String(e&&e.message||e)});});
}catch(e){post({type:'error',message:String(e&&e.message||e)});}
</script></body></html>`;

export const PhoneVerifierHost = forwardRef<PhoneVerifierHandle>(function PhoneVerifierHost(_props, ref) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);

  useImperativeHandle(ref, () => ({
    getVerifier: () => ({
      type: 'recaptcha',
      verify: () =>
        new Promise<string>((resolve, reject) => {
          pending.current = { resolve, reject };
          setVisible(true);
        }),
      _reset: () => {},
    }),
  }));

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = JSON.parse(e.nativeEvent.data) as { type: string; token?: string; message?: string };
    if (!pending.current) return;
    if (msg.type === 'token' && msg.token) pending.current.resolve(msg.token);
    else pending.current.reject(new Error(msg.message ?? 'reCAPTCHA failed'));
    pending.current = null;
    setVisible(false);
  };

  const cancel = () => {
    pending.current?.reject(new Error('Verification cancelled'));
    pending.current = null;
    setVisible(false);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={cancel}>
      <View style={{ flex: 1, paddingTop: 50, backgroundColor: colors.white }}>
        <Text style={{ textAlign: 'center', fontWeight: '800', fontSize: 16, marginBottom: 8 }}>{t('login.securityCheck')}</Text>
        {visible && (
          <WebView
            originWhitelist={['*']}
            javaScriptEnabled
            source={{ html: html(), baseUrl: `https://${firebaseConfig.authDomain}` }}
            onMessage={onMessage}
            style={{ flex: 1 }}
          />
        )}
        <Pressable onPress={cancel} style={{ padding: 18, alignItems: 'center' }}>
          <Text style={{ fontWeight: '800', color: colors.danger }}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
});

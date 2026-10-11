/** F135-5: /courts (typed or old links) used to show "Unmatched Route"; courts live on the Map tab. */
import { Redirect } from 'expo-router';
import React from 'react';

export default function CourtsRedirect() {
  return <Redirect href="/map" />;
}

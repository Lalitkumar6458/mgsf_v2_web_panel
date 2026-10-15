// Trust letterhead used at the top of every PDF.
// headerMode "auto" (default) draws it from the trust profile — logo | name, address,
// registration, phone | right logo — so a change in Settings → Organization shows up
// in every PDF. headerMode "image" uses the uploaded header picture instead.
// Needs the 'NotoSansDevanagari' font (normal + bold) registered by the document.
import { Image, StyleSheet, Text, View } from '@react-pdf/renderer'
import React from 'react'
import { normalizeTrust, regLine } from '@/lib/trust/profile'

const RED = '#e0262b'

const styles = StyleSheet.create({
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 7,
  },
  headerImg: {
    width: '100%',
    height: 110,
    objectFit: 'fill',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  name: { fontFamily: 'NotoSansDevanagari', fontWeight: 'bold', color: RED, textAlign: 'center' },
  line: { fontFamily: 'NotoSansDevanagari', color: '#111', textAlign: 'center' },
  reg: { fontFamily: 'NotoSansDevanagari', fontWeight: 'bold', color: RED, textAlign: 'center' },
  logo: { objectFit: 'contain' },
})

export const PdfTrustHeader = ({ height = 110, TrustData, noMargin = false }) => {
  const t = TrustData && TrustData.name !== undefined ? TrustData : normalizeTrust(TrustData)

  if (t.headerMode === 'image' && t.headerImg) {
    return (
      <View style={[styles.headerSection, noMargin && { marginBottom: 0 }]}>
        <Image src={t.headerImg} style={[styles.headerImg, { height }]} />
      </View>
    )
  }

  // sizes scale with the requested height (80 on the closing form, 110 elsewhere)
  const logo = Math.round(height * 0.86)
  const nameSize = Math.max(11, Math.min(26, Math.round(height * 0.2)))
  const lineSize = Math.max(6.5, Math.round(height * 0.085 * 10) / 10)
  const right = t.RightLogo || t.logo
  const reg = regLine(t)

  return (
    <View style={[styles.headerSection, { height }, noMargin && { marginBottom: 0 }]}>
      {t.logo ? <Image src={t.logo} style={[styles.logo, { width: logo, height: logo }]} /> : <View style={{ width: logo }} />}
      <View style={styles.center}>
        <Text style={[styles.name, { fontSize: nameSize }]}>{t.name}</Text>
        {t.cityState ? <Text style={[styles.line, { fontSize: lineSize }]}>{t.cityState}</Text> : null}
        {t.address ? <Text style={[styles.line, { fontSize: lineSize, marginTop: 2 }]}>{t.address}</Text> : null}
        {t.contact ? <Text style={[styles.line, { fontSize: lineSize, marginTop: 1 }]}>मो. {t.contact}</Text> : null}
        {reg ? <Text style={[styles.reg, { fontSize: lineSize + 1.5, marginTop: 3 }]}>{reg}</Text> : null}
      </View>
      {right ? <Image src={right} style={[styles.logo, { width: logo, height: logo }]} /> : <View style={{ width: logo }} />}
    </View>
  )
}

const PdfHeaderCom = ({ height, TrustData }) => <PdfTrustHeader height={height || 110} TrustData={TrustData} />

export default PdfHeaderCom

# WhatsApp (Gupshup) — setup har trust ke liye

Panel har trust ke **apne** Gupshup app / WhatsApp number se 3 message apne aap bhejta hai:

| # | Kab | Saath mein PDF |
|---|---|---|
| 1 | Member jodte waqt ya request accept karte waqt **"WhatsApp par welcome bhejein"** tick karne par. Ye tick default mein khaali rehta hai, aur ek member ko message sirf ek baar jaata hai | सदस्यता प्रमाण पत्र |
| 2 | **Baki payment** — nayi closing darj hote hi (option) ya panel se "sabko ek saath" button | बकाया रसीद |
| 3 | **Payment jama** hote hi — us payment ki | जमा रसीद |

Member ka jawab **Settings → WhatsApp inbox** mein aata hai. 24 ghante ke andar wahin se reply ho jata hai.

## 1. Gupshup par (ek baar, har trust)
1. gupshup.io par account → **WhatsApp → Create App**. App ka naam yaad rakhein (panel mein "app name").
2. Trust ka number jodein: Facebook Business Manager verify + ek naya number. Jo number abhi WhatsApp app mein chal raha hai, wo nahi lagega. Pehle use WhatsApp se hatana padega.
3. **Wallet** mein balance daalein. Har message ka Meta / Gupshup charge lagta hai (utility message sasta hota hai).
4. **Templates → New**: teeno template banayein, category **Utility**, header **Document**. Neeche diye text jaisa likh sakte hain. Approve hone mein kuch minute se 1 din tak lagta hai.
5. Approve hone par har template ki **Template ID** copy karein.
6. **API key**: Gupshup dashboard → profile / account settings → API key.

## 2. Panel mein (Settings → WhatsApp)
1. API key, WhatsApp number (91XXXXXXXXXX), app name bharein. Upar ka switch **Chalu** karein.
2. **Callback URL** Copy karein aur Gupshup → App → **Webhooks / Callback URL** mein paste karein (V2 format): `https://<aapka-domain>/api/whatsapp/callback`. Ye URL sab trust ke liye ek hi hai, isme trust ID ya key nahi hoti.
   - Header jod sakein to naam `x-webhook-key` aur value = panel wali key daal dein. Key se trust pehchana jaata hai. Galat key aayi to message reject ho jayega.
   - Header na lagaya to trust Gupshup ke **app name** se pehchana jaata hai (har callback mein `app` aata hai). Isliye panel mein "Gupshup app name" bilkul Gupshup jaisa likhein. Do trust ka app name same na rakhein.
   - **localhost wala URL Gupshup kabhi accept nahi karega.** Wo sirf internet par khula https URL leta hai, isliye pehle server par deploy karein.
   - Local PC par test karna ho to `npx cloudflared tunnel --url http://localhost:3000` chalayein aur usse mila https URL use karein (aakhir mein `/api/whatsapp/callback` jodkar).
3. Har message ke liye:
   - **Template ID** paste karein.
   - **Template ka text** wahi paste karein jo Gupshup mein approve hua. Usme jitne `{{1}} {{2}}` hain, panel utni jagah apne aap bana dega.
   - Har `{{n}}` ke aage **+ Variable** se chunein: naam, reg. no., bakaya, tareekh… Saath mein text bhi likh sakte hain, jaise `₹{pendingAmount}`.
   - **PDF** chunein, phir message ka switch **Chalu** karein.
4. **Save** karein, phir apne number par **Test** bhejein.
5. Feature-control mein **"WhatsApp API (Gupshup)"** switch on hona chahiye.

> PDF ka link server khud banata hai (`/api/wa/file/...`), signed rehta hai aur 30 din chalta hai. Gupshup PDF wahin se uthata hai, isliye server ka domain HTTPS par khula hona chahiye (`PUBLIC_BASE_URL` .env mein sahi ho).

## Sample template (Gupshup mein approval ke liye)
**1. Join (header: Document)**
```
नमस्ते {{1}} जी 🙏
{{3}} में आपका स्वागत है। आपका रजिस्ट्रेशन नंबर {{2}} है।
आपका सदस्यता प्रमाण पत्र साथ में भेजा गया है।
— {{4}}
```
Variables: `{name}` `{regNo}` `{program}` `{trust}`

**2. Baki (header: Document)**
```
नमस्ते {{1}} जी, {{2}} की {{3}} क्लोजिंग का ₹{{4}} बकाया है।
कृपया {{5}} तक जमा करें। बकाया रसीद साथ में है।
— {{6}}
```
Variables: `{name}` `{program}` `{pendingCount}` `{pendingAmount}` `{lastDate}` `{trust}`

**3. Jama (header: Document)**
```
नमस्ते {{1}} जी, आपका ₹{{2}} का भुगतान {{3}} को जमा हो गया है।
रसीद साथ में है। धन्यवाद 🙏
— {{4}}
```
Variables: `{name}` `{paidAmount}` `{paidDate}` `{trust}`

## Dhyan rahe
- WhatsApp ke niyam se member ke aakhri message ke 24 ghante baad sirf **template** message ja sakta hai. Inbox ka reply box tab band ho jata hai.
- Fail ka kaaran **Bheje gaye message** table mein dikhta hai, jaise `1008: User is not Opted in` ya template ID galat.
- Template mein jitne `{{n}}` hain, utne hi value jaati hai. Text badla ho to panel mein bhi wahi text paste karein.
- Jis member ka mobile number nahi hai, use message nahi jaata.

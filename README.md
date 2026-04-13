# MI BALSTĪTA LIETOJUMPROGRAMMA STUDIJU KURSA VĀRDNĪCAS IZVEIDEI

## Pārskats
Šis projekts ir prototips, kas paredzēts studiju kursu vārdnīcu izveidei no dažādiem mācību materiāliem. Tas izmanto lielos valodas modeļus (LLM), lai identificētu galvenos terminus un iegūtu definīcijas, automatizējot procesu, kas tradicionāli ir manuāls un laikietilpīgs.

<p align="center">
  <img src="https://i.imgur.com/nQvx3ES.png" alt="Project Screenshot">
</p>

## Funkcijas
- Automātiska terminu un definīciju iegūšana, izmantojot lielos valodas modeļus.
- Dokumentu, attēlu un audio failu apstrāde.
- Optiskā rakstzīmju atpazīšana (OCR) dokumentiem un attēliem.
- Audio transkripcija lekciju ierakstiem.
- Tīmekļa saskarne reāllaika statusa uzraudzībai un rezultātu pārvaldībai.
- Manuālas rediģēšanas iespēja AI ģenerētā satura labošanai.
- Eksporta funkcionalitāte PDF formātā.

## Atbalstītie formāti
- Dokumenti: PDF, DOCX, DOC, DOTX, DOT, DOCM, DOTM, ODT, RTF, TXT.
- Prezentācijas: PPTX, POTX, PPTM, POTM, ODP.
- Attēli: JPG, JPEG, PNG, GIF, TIFF, TIF, BMP, WEBP.
- Audio: MP3, WAV, FLAC, OGG, M4A, AMR, MP4, AVI, MKV, MOV, FLV, WEBM.

## Tehnoloģiju steks
- Frontends: HTML, CSS (Tailwind CSS), JavaScript.
- Backend: Node.js (TypeScript), Express.
- Komunikācija: Socket.IO reāllaika atjauninājumiem.
- MI ieviešana: LLM integrācija, izmantojot LMStudio ar strukturētu JSON izvadi.
- Apstrādes rīki: FFMPEG multivides apstrādei, Tesseract.js OCR, un Whisper transkripcijai.

## Instalācija un iestatīšana
1. Klonējiet repozitoriju.
2. Instalējiet atkarības: `npm install`
3. Instalējiet LMStudio un lejupielādējiet nepieciešamo modeli: `https://lmstudio.ai/`
4. Visa konfigurācija atrodama `src/config.ts` failā.
5. Palaidiet lietotni: `npm run dev`

## Lietošana
1. Augšupielādējiet failus, izmantojot vilkšanas un nomešanas saskarni.
2. Novērojiet izguves un apstrādes progresu izsekošanas panelī.
3. Pārskatiet iegūtos terminus un definīcijas vārdnīcas rezultātu sadaļā.
4. Rediģējiet vai dzēsiet ierakstus pēc vajadzības.
5. Eksportējiet gala vārdnīcu PDF failā.

## Eksperimenti

Eksperimentu datu kopas un rezultātus, kas iekļauj zelta standartu, ievaddatus un izvaddatus, var aplūkot šeit: [NOKLIKŠĶINI](/experiments)
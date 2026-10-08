#!/bin/sh
# Gera o aplicativo Android do entregador (docs/tia-ce-entregas.apk).
# Precisa do JDK 21 e do Android SDK instalados (JAVA_HOME e ANDROID_HOME). O site embutido no aplicativo usa
# o banco de .env.production.local, o mesmo do site publicado.
set -e
cd "$(dirname "$0")/../.."
[ -f .env.production.local ] || { echo "Falta o arquivo .env.production.local com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY."; exit 1; }
npm run build
npx cap sync android
(cd android && ./gradlew --quiet assembleRelease)
cp android/app/build/outputs/apk/release/app-release.apk docs/tia-ce-entregas.apk
echo "Aplicativo gerado: docs/tia-ce-entregas.apk"

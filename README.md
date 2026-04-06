# Chama da Felicidade 🔥

Diário pessoal com gratidão, manchete jornalística do dia e Roda da Vida.

## Deploy no GitHub Pages

### 1. Criar repositório
```
Nome: chama-da-felicidade
Visibilidade: Public
```

### 2. Configurar Firebase

No arquivo `index.html`, substitua o objeto `firebaseConfig` com os dados do seu projeto Firebase (`kpi-tracker-f0b35`):

```js
const firebaseConfig = {
  apiKey: "sua-api-key",
  authDomain: "kpi-tracker-f0b35.firebaseapp.com",
  projectId: "kpi-tracker-f0b35",
  storageBucket: "kpi-tracker-f0b35.appspot.com",
  messagingSenderId: "seu-messaging-sender-id",
  appId: "seu-app-id"
};
```

Para encontrar esses valores: Firebase Console → Configurações do Projeto → Seus apps.

### 3. Firebase — Regras do Firestore

No Firebase Console → Firestore → Regras:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /chamadas/{doc} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.uid;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.uid;
    }
  }
}
```

### 4. Firebase — Domínio autorizado

Firebase Console → Authentication → Settings → Authorized domains:
Adicione: `luizadrianorj.github.io`

### 5. Upload dos arquivos

Suba para o repositório:
- `index.html`
- `manifest.json`
- `sw.js`
- `icon-192.png` (ícone 192×192px)
- `icon-512.png` (ícone 512×512px)

### 6. Ativar GitHub Pages

Settings → Pages → Branch: `main` → `/root` → Save

O app ficará em:
`https://luizadrianorj.github.io/chama-da-felicidade`

## Estrutura dos dados (Firestore)

Coleção: `chamadas`

```json
{
  "uid": "string (ID do usuário)",
  "headline": "string (manchete do dia)",
  "lead": "string (texto jornalístico)",
  "gratidoes": ["string", "string", "string"],
  "eixos": ["Saúde e Disposição", "Família"],
  "createdAt": "Timestamp"
}
```

## Notificações diárias (21h)

As notificações push nativas exigem HTTPS (já garantido pelo GitHub Pages).
O app solicita permissão de notificação automaticamente no primeiro acesso.
Para agendar notificações recorrentes às 21h, você pode usar um serviço como
OneSignal (gratuito) ou configurar via Firebase Cloud Messaging no futuro.

const admin = require('firebase-admin');

admin.initializeApp({ credential: admin.credential.applicationDefault() });

const db = admin.firestore();

db.collection('targetUsers').get()
  .then(snap => snap.docs.forEach(d => console.log(d.id, d.data())))
  .catch(err => console.error(err));

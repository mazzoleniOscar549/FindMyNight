/**
 * Config pubblica Firebase Web SDK (l’apiKey è pensata per il client).
 * In Google Cloud Console / Firebase: limita con referer HTTP, abilita App Check
 * dove possibile, e regola le regole Firestore/Storage.
 */
(function () {
    window.FMN_FIREBASE_CONFIG = {
        apiKey: 'AIzaSyCRSulrH3CEDXtIieCKNnQt909QTO5-CSM',
        authDomain: 'findmynight-77777.firebaseapp.com',
        projectId: 'findmynight-77777',
        storageBucket: 'findmynight-77777.firebasestorage.app',
        messagingSenderId: '376211745003',
        appId: '1:376211745003:web:54caad8947ab34a1e776ae',
        measurementId: 'G-4B41LWXFR3'
    };
})();

/* =========================================================
   Partage éphémère — le relais (TURN), pour se connecter hors du même Wi-Fi
   D'abord, les deux appareils essaient le tuyau direct (grâce au STUN, qui dit à chacun
   son adresse sur internet, comme lire son adresse sur une enveloppe reçue).
   Si un pare-feu ou la 4G bloque le direct, les paquets passent par le relais de Metered,
   comme par un bureau de poste. Le port 443 est la porte du web, presque jamais fermée.
   Les identifiants sont visibles dans la page : c'est normal, il n'y a pas de serveur à nous.
   ========================================================= */
"use strict";

const RELAIS_NOM = "fdb646df21a2cc5f0127b869";
const RELAIS_CLE = "QlEZMhmebDM08LRZ";
const RELAIS = "global.relay.metered.ca";

// La configuration donnée à chaque new Peer (hôte et invité)
const CONFIG_PEER = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.relay.metered.ca:80" },
      {
        urls: [
          "turn:" + RELAIS + ":80",
          "turn:" + RELAIS + ":80?transport=tcp",
          "turn:" + RELAIS + ":443",
          "turns:" + RELAIS + ":443?transport=tcp",
        ],
        username: RELAIS_NOM,
        credential: RELAIS_CLE,
      },
    ],
  },
};

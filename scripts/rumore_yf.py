# -*- coding: utf-8 -*-
"""LE PROTESTE DI YFINANCE: raccolte e riassunte per CAUSA, mai buttate.

⚠ NON E' UN SILENZIATORE, ed e' la distinzione che conta.
  yfinance scrive su stderr per ogni titolo e per ogni tentativo: con 13 titoli e 3 tentativi
  sono ~200 righe, e quelle righe dicono "possibly delisted" di societa' vive. Il muro
  seppelliva l'unica riga che conta davvero — quella che dichiara il ripiego — ed e' la classe
  v315 (una dichiarazione che c'e' e non si trova non e' una dichiarazione).
  La regola del progetto "i fallback devono essere RUMOROSI" non viene indebolita: viene
  RAFFORZATA, perche' la nostra riga sale in cima e porta la CAUSA invece di stare in fondo.

⚠ E la causa e' l'informazione vera: "CONNECT 403" dice che la rete blocca Yahoo; le stesse
  "possibly delisted" ripetute tredici volte dicono il contrario di quello che sembrano dire.

⚠ QUESTO FILE E' LA FONTE UNICA, e non e' un vezzo: la raccolta serve sia al rapporto sia alla
  pipeline. Due copie della stessa domanda divergono al primo ritocco — e' la classe v161/v207,
  gia' pagata piu' volte in questo progetto.
"""
import logging


class RaccoltaYF(logging.Handler):
    """Un handler che accumula i messaggi invece di stamparli, e sa raggrupparli per causa."""

    CAUSE = (
        ("403", "il proxy di rete rifiuta la connessione a Yahoo (CONNECT 403)"),
        ("possibly delisted", "nessuna barra restituita (conseguenza del blocco, non un delisting)"),
        ("crumb", "Yahoo non rilascia il cookie/crumb di sessione"),
        ("Rate limit", "Yahoo sta limitando le richieste"),
    )

    def __init__(self):
        super().__init__()
        self.righe = []

    def emit(self, record):
        try:
            self.righe.append(record.getMessage())
        except Exception:      # noqa: BLE001 — un handler non deve MAI far cadere chi logga
            pass

    def riassunto(self):
        """Una riga per CAUSA distinta, col numero di messaggi che la portano.

        ⚠ Nessun messaggio si perde: quello che non rientra in nessuna classe viene contato
          e CITATO. Un riassunto che scarta il residuo sarebbe di nuovo un silenziatore.
        """
        fuori = []
        residuo = list(self.righe)
        for ago, spiega in self.CAUSE:
            n = sum(1 for r in residuo if ago in r)
            if n:
                fuori.append(f"{n} messaggi: {spiega}")
                residuo = [r for r in residuo if ago not in r]
        if residuo:
            fuori.append(f"{len(residuo)} messaggi non classificati, il primo: "
                         f"{residuo[0][:120]}")
        return fuori


def zittisci_yfinance():
    """Dirotta il logger di yfinance su una RaccoltaYF. Ritorna (raccolta, ripristina)."""
    racc = RaccoltaYF()
    lg = logging.getLogger("yfinance")
    prima_h, prima_p, prima_l = list(lg.handlers), lg.propagate, lg.level
    lg.handlers = [racc]
    lg.propagate = False
    # ⚠ IL LIVELLO VA IMPOSTATO QUI, e non e' un dettaglio: chi importa per primo decide cosa
    #   l'altro riesce a vedere. Prima di questa riga la cattura del rapporto funzionava solo
    #   perche' rapporto.py non importa la pipeline — cioe' per l'ordine degli import e non per
    #   costruzione. Trovato da un check andato rosso proprio perche' la suite importa entrambi.
    lg.setLevel(logging.WARNING)

    def ripristina():
        lg.handlers, lg.propagate, lg.level = prima_h, prima_p, prima_l

    return racc, ripristina

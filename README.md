# ThunderCat 6.1.1 – Thunderbird Add-on

ThunderCat 6.0 ist die Thunderbird-Add-on-Version des bisherigen
Python/Streamlit-Projekts.

## Funktionsprinzip

Neue Nachrichten werden nach Absender und Betreff einer von sieben festen
Hauptkategorien zugeordnet:

- Arbeit
- Finanzen
- Shopping
- Webhosting
- Newsletter
- Privat
- Sonstiges

Darunter erzeugt ThunderCat automatisch einen Unterordner anhand der
Absenderdomain.

Beispiele:

```text
INBOX/Arbeit/example-firma.de
INBOX/Finanzen/paypal.de
INBOX/Shopping/amazon.de
INBOX/Webhosting/goneo.de
INBOX/Newsletter/heise.de
```

ThunderCat verwendet die Thunderbird-Ordner-API. Die Ordner werden damit
direkt im jeweiligen Mailkonto angelegt und sind sofort Teil der
Thunderbird-/IMAP-Ordnerstruktur. Eine `msgFilterRules.dat` ist für die
ThunderCat-Sortierung nicht mehr erforderlich.

## KI-Provider

### Mistral

Standardmodell:

```text
mistral-small-latest
```

Für die vollautomatische Sortierung wird ein Mistral API-Key benötigt.

### ChatGPT / OpenAI API

Standardmodell:

```text
gpt-6-luna
```

Für die automatische Klassifizierung wird ein OpenAI API-Key benötigt.
Die OpenAI-API-Abrechnung ist von einem normalen ChatGPT-Abonnement getrennt.

## Datenschutz

ThunderCat sendet zur KI-Klassifizierung nur:

- Absendername
- Absender-E-Mail-Adresse
- Absenderdomain
- bis zu fünf unterschiedliche Betreffzeilen

Der Nachrichtentext und Anhänge werden nicht an die KI gesendet.

API-Keys werden lokal im Erweiterungsspeicher von Thunderbird gespeichert.
Dieser Speicher ist keine spezielle Passwort-Tresor-Lösung. Wer besonders
hohe Anforderungen an die Schlüsselverwaltung hat, sollte einen separaten,
eingeschränkten API-Key verwenden.

## Gelernte Absender

Die KI wird nur für unbekannte Absender benötigt.

Nach der ersten Klassifizierung speichert ThunderCat beispielsweise:

```text
bestellbestaetigung@amazon.de -> Shopping
billing@goneo.de              -> Webhosting
service@paypal.de             -> Finanzen
```

Weitere Nachrichten desselben Absenders können ohne erneuten KI-Aufruf
einsortiert werden.

## Kontextmenü

Im Thunderbird-Nachrichtenfenster:

```text
Rechtsklick auf Nachricht
└─ ThunderCat
   ├─ Zu Shopping lernen
   ├─ Zu Privat lernen
   ├─ Zu Newsletter lernen
   ├─ Zu Finanzen lernen
   ├─ Zu Webhosting lernen
   ├─ Zu Arbeit lernen
   └─ Zu Sonstiges lernen
```

Damit lässt sich eine KI-Zuordnung mit einem Klick korrigieren.

## Installation

1. Thunderbird öffnen.
2. `Add-ons und Themes` öffnen.
3. Zahnrad-Menü öffnen.
4. `Add-on aus Datei installieren…` auswählen.
5. `ThunderCat_6_0.xpi` auswählen.
6. Berechtigungen bestätigen.
7. Über das ThunderCat-Symbol die Einstellungen öffnen.
8. KI-Provider, API-Key und gewünschte Mailkonten einstellen.
9. Mit `Provider testen` prüfen.
10. `7 Hauptordner jetzt anlegen / prüfen` ausführen.

## Bestehende Thunderbird-Filter

Wenn noch alte ThunderCat-Filter aus `msgFilterRules.dat` aktiv sind, sollten
diese deaktiviert werden, damit Nachrichten nicht gleichzeitig von alten
Thunderbird-Regeln und vom neuen Add-on verschoben werden.

## Thunderbird-Version

Manifest V3, Mindestversion Thunderbird 128.

## Dateien

- `manifest.json` – Add-on-Metadaten und Berechtigungen
- `background.js` – Sortierlogik, KI-Aufrufe, Ordnererstellung
- `popup/` – Toolbar-Popup
- `options/` – Einstellungen und gelernte Absender
- `icons/` – ThunderCat-Icons


## Fix 6.0.1 – „Receiving end does not exist“

ThunderCat verwendet jetzt eine explizite `background.html` statt einer
automatisch erzeugten Background-Page.

Popup und Einstellungsseite greifen primär über
`runtime.getBackgroundPage()` direkt auf `ThunderCatAPI` zu. Das normale
`runtime.sendMessage()` bleibt als Fallback erhalten.

Außerdem wird der Runtime-Message-Listener vor den Menü- und Mail-Listenern
registriert. Dadurch kann ein Fehler bei einem optionalen Listener die
Kommunikation mit der Einstellungsseite nicht mehr verhindern.

Nach einem Update auf 6.0.1 Thunderbird bitte einmal neu starten.


## Änderung 6.0.2 – Reihenfolge der Hauptkategorien

ThunderCat verwendet intern jetzt diese Reihenfolge:

```text
Arbeit
Finanzen
Shopping
Webhosting
Newsletter
Privat
Sonstiges
```

Diese Reihenfolge wird beim Erstellen der Ordner, im Kontextmenü und in den
Einstellungen verwendet.

Hinweis: Thunderbird beziehungsweise der IMAP-Server kann die sichtbare
Ordnerliste unabhängig davon alphabetisch sortieren. Wenn eine feste sichtbare
Reihenfolge im Thunderbird-Ordnerbaum benötigt wird, sind numerische Präfixe
wie `01 Arbeit`, `02 Finanzen` usw. die zuverlässigere Variante.


## Neu in 6.1.0

### Hauptordner

```text
INBOX/
├─ Arbeit/<domain>
├─ Finanzen/<domain>
├─ Shopping/<domain>
├─ Digitales/<domain>
├─ Newsletter/<domain>
├─ Privat/<domain>
└─ Unsicher/<domain>
```

`Digitales` umfasst Webhosting, Domains, Server, DNS, SSL, Webspace,
Telekommunikation, Mobilfunkanbieter, Internetanbieter, Fernsehen,
Streamingdienste und digitale Abonnements.

`Unsicher` enthält fragwürdige, unbekannte, verdächtige oder als Spam/Phishing
erkannte Nachrichten sowie nicht zuverlässig klassifizierbare Absender.

Gespeicherte Zuordnungen werden automatisch migriert:

```text
Webhosting -> Digitales
Sonstiges  -> Unsicher
Spam       -> Unsicher
Unklar     -> Unsicher
```

Ein bereits vorhandener alter IMAP-Ordner `Sonstiges` wird aus Sicherheitsgründen
nicht automatisch gelöscht. ThunderCat verwendet ihn nicht mehr für neue Mails.

### Neue Ordner automatisch verwenden

Fehlende Haupt- und Domainordner werden bei aktivierter Option automatisch angelegt
und unmittelbar als Zielordner verwendet.

### Unterordner beim manuellen Scan

In der Konfiguration gibt es jetzt:

```text
[ ] Auch Unterordner beim manuellen Scan einbeziehen
```

Ausgeschaltet: nur INBOX. Eingeschaltet: INBOX plus sämtliche Unterordner.
Nachrichten, die bereits im richtigen Zielordner liegen, werden nicht erneut verschoben.
\n\n## Fix 6.1.1 – robuste IMAP-Moves\n\nThunderCat verschiebt Nachrichten jetzt einzeln statt in großen IMAP-Batches.\nSchlägt ein Move fehl, wird er bis zu dreimal versucht. Zwischen den Versuchen\nliegen kurze Wartezeiten. Nach einem Fehler prüft ThunderCat außerdem, ob der\nServer die Nachricht möglicherweise trotzdem bereits in den Zielordner\nverschoben hat.\n\nNeu angelegte IMAP-Ordner erhalten vor dem ersten Move einen kurzen\nSynchronisationspuffer und werden danach erneut über die Ordner-API ermittelt.\nEin dauerhaft fehlerhafter Move stoppt nicht mehr den kompletten Sortierlauf,\nsondern wird im Aktivitätsprotokoll als `move-error` festgehalten.\n
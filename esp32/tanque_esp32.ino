// ESP32 -> Vercel vía GET. El ESP32 decide el estado de la bomba con sus sensores;
// la web solo muestra ese estado y envía la orden manual.
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
const char* SSID="TU_WIFI"; const char* PASS="TU_CLAVE";
const char* HOST="https://TU-PROYECTO.vercel.app";
#define LS101 32
#define LSH201 33
#define LSL202 25
#define RELE 14
int orden=-2; // -2 sin orden; 0/1 orden manual
void setup(){Serial.begin(115200);pinMode(LS101,INPUT_PULLUP);pinMode(LSH201,INPUT_PULLUP);pinMode(LSL202,INPUT_PULLUP);
  pinMode(RELE,OUTPUT);digitalWrite(RELE,LOW);WiFi.begin(SSID,PASS);while(WiFi.status()!=WL_CONNECTED)delay(300);}
void loop(){
  int ls=!digitalRead(LS101), lsh=!digitalRead(LSH201), lsl=!digitalRead(LSL202);
  int bomba=digitalRead(RELE);
  // Envia estado real y recibe la orden manual (si la hay)
  String url=String(HOST)+"/api/data?ls101="+ls+"&lsh201="+lsh+"&lsl202="+lsl+"&bomba="+bomba+"&id=ESP32-01&fmt=txt";
  WiFiClientSecure c; c.setInsecure(); HTTPClient http; http.begin(c,url);
  if(http.GET()==200){String r=http.getString(); Serial.println(r);
    if(r.indexOf("MODO=manual")>=0) orden=r.indexOf("BOMBA=1")>=0?1:0; else orden=-2;}
  else orden=-2; // sin red: sigue su lógica local
  http.end();
  // Decisión local (autoridad del proceso)
  if(orden>=0) bomba=orden;                          // orden manual recibida
  else bomba = (!ls||lsh)?0:(lsl?1:bomba);          // automático: arranque en bajo, parada en alto
  if(!ls) bomba=0;                                   // protección contra marcha en seco (LS-101)
  digitalWrite(RELE,bomba);
  delay(5000);}

// The dish's and router's grpc-web endpoints, reached directly. Host permissions
// exempt the extension from the CORS and Local Network Access limits a web page
// hits, so unlike the dev server and the desktop app it needs no same-origin
// proxy in front of the LAN boxes.
export const DISH_HANDLE_URL = "http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle";
export const ROUTER_HANDLE_URL = "http://192.168.1.1:9001/SpaceX.API.Device.Device/Handle";

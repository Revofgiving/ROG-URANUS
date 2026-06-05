import { apiUranusService } from "./api-service";
import { mockUranusService } from "./mock-service";

export type {
  DonoResponse,
  DonoPendente,
  FlussiEsterniResponse,
  HealthResponse,
  Messaggio,
  PercorsoResponse,
  PosizioneResponse,
  StatoSistema,
  UranusService,
} from "./types";

const useMocks = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

export const uranusService = useMocks ? mockUranusService : apiUranusService;

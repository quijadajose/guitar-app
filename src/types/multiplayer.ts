export type GameMode = 'classic' | 'sudden_death' | 'face_off';
export type PlayerRole = 'host' | 'guest' | 'spectator';
export type AttackType = 'invert_screen' | 'blind_strings' | 'turbo_speed';

export interface PlayerSummary {
  session_id: string;
  name: string;
  role: PlayerRole;
  ready: boolean;
  score: number;
  combo: number;
  accuracy: number;
  is_disqualified?: boolean;
}

// Mensajes enviados desde el cliente
export type ClientMessage =
  | { type: 'ping'; payload: { client_ts: number } }
  | {
      type: 'create_room';
      payload: {
        song_id: string;
        mode: GameMode;
        player_name: string;
        is_public: boolean;
      };
    }
  | {
      type: 'join_room';
      payload: {
        room_code: string;
        player_name: string;
        as_spectator: boolean;
      };
    }
  | { type: 'set_ready'; payload: { ready: boolean } }
  | { type: 'update_room'; payload: { song_id: string; mode: GameMode; is_public: boolean } }
  | { type: 'start_game'; payload?: Record<string, never> }
  | {
      type: 'player_progress';
      payload: {
        score: number;
        combo: number;
        accuracy: number;
        measure: number;
      };
    }
  | {
      type: 'note_hit';
      payload: {
        note_id: number;
        rating: string;
        cents_offset: number;
      };
    }
  | {
      type: 'send_attack';
      payload: {
        attack_type: AttackType;
        duration_ms: number;
      };
    }
  | {
      type: 'player_eliminated';
      payload: {
        reason: string;
        final_score: number;
      };
    }
  | {
      type: 'submit_summary';
      payload: {
        final_score: number;
        max_combo: number;
        accuracy: number;
        hits: number;
        total_notes: number;
        checksum: string;
      };
    }
  | { type: 'request_rematch'; payload?: Record<string, never> };

// Mensajes recibidos del servidor
export type ServerMessage =
  | { type: 'pong'; payload: { client_ts: number; server_ts: number } }
  | {
      type: 'room_created';
      payload: {
        room_code: string;
        session_id: string;
        role: PlayerRole;
        song_id: string;
        mode: GameMode;
        is_public?: boolean;
      };
    }
  | {
      type: 'room_joined';
      payload: {
        room_code: string;
        session_id: string;
        role: PlayerRole;
        song_id: string;
        mode: GameMode;
        is_public?: boolean;
        players: PlayerSummary[];
        spectators_count: number;
      };
    }
  | {
      type: 'room_updated';
      payload: {
        players: PlayerSummary[];
        spectators_count: number;
      };
    }
  | {
      type: 'room_settings';
      payload: {
        song_id: string;
        mode: GameMode;
        is_public: boolean;
      };
    }
  | {
      type: 'game_starting';
      payload: {
        start_at_epoch_ms: number;
        countdown_ms: number;
      };
    }
  | {
      type: 'opponent_progress';
      payload: {
        session_id: string;
        score: number;
        combo: number;
        accuracy: number;
        measure: number;
      };
    }
  | {
      type: 'opponent_note_hit';
      payload: {
        session_id: string;
        note_id: number;
        rating: string;
        cents_offset: number;
      };
    }
  | {
      type: 'apply_attack';
      payload: {
        from_session_id: string;
        attack_type: AttackType;
        duration_ms: number;
      };
    }
  | {
      type: 'opponent_eliminated';
      payload: {
        session_id: string;
        reason: string;
        final_score: number;
      };
    }
  | {
      type: 'rematch_requested';
      payload: {
        by_session_id: string;
      };
    }
  | {
      type: 'error';
      payload: {
        message: string;
      };
    }
  | {
      type: 'room_closing';
      payload: {
        closes_in_secs: number;
        reason: 'empty' | 'idle';
      };
    }
  | {
      type: 'room_closed';
      payload: {
        reason: 'empty' | 'idle';
      };
    };

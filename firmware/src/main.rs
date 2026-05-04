#![no_main]
#![no_std]

use rmk::macros::rmk_keyboard;

#[rmk_keyboard]
mod keyboard {
    // PollingController トレイトはマクロ展開後の `status_led.polling_loop()` 呼び出しに
    // 必要なので、mod 直下の `use` でファイルスコープに上げる。Controller も同様。
    use rmk::controller::{Controller, PollingController};

    // SPIM3 の割り込みハンドラを RMK 生成の `bind_interrupts!(struct Irqs { ... })` に追加。
    // `add_interrupt!` は実マクロではなく rmk-macro が拾うシンボルで、トークンがそのまま
    // bind_interrupts! 構造体内に展開される。
    // 注: nRF52840 の SPIM3 ペリフェラル型は embassy-nrf では `SPI3` (`impl_spim!(SPI3, SPIM3, SPIM3)`)。
    // 割り込みベクタ名は SPIM3 のまま。
    add_interrupt! {
        SPIM3 => ::embassy_nrf::spim::InterruptHandler<::embassy_nrf::peripherals::SPI3>;
    }

    /// SK6812 ステータス LED + AO3401A PMOS ゲート制御コントローラ。
    /// `#[controller(poll)]` で RMK macro が `polling_loop()` を join_all_tasks に追加する。
    #[controller(poll)]
    fn status_led() {
        use embassy_nrf::gpio::{Level, Output, OutputDrive};
        use embassy_nrf::spim::{self, Spim};
        use embassy_time::{Duration, Instant, Timer};
        use rmk::ble::BleState;
        use rmk::channel::{ControllerSub, CONTROLLER_CHANNEL};
        use rmk::event::ControllerEvent;

        // SK6812 タイミング (revB SSOT §6.2):
        //   SPI 4 MHz、1 LED ビット = 4 SPI ビット (1µs/bit)
        //     0 → 0b1000 (T0H 250ns + T0L 750ns)
        //     1 → 0b1100 (T1H 500ns + T1L 500ns)
        //   1 LED あたり 24 LED ビット = 96 SPI ビット = 12 バイト
        const SK6812_BYTES: usize = 12;
        const IDLE_TIMEOUT: Duration = Duration::from_secs(20);
        const POLL_INTERVAL: Duration = Duration::from_millis(100);
        const BLINK_HALF_PERIOD_MS: u64 = 400;

        enum Pattern {
            Off,
            Solid(u8, u8, u8),
            Blink(u8, u8, u8),
        }

        struct StatusLed {
            spim: Spim<'static>,
            pmos: Output<'static>,
            sub: ControllerSub,
            ble_state: BleState,
            battery_level: Option<u8>,
            is_charging: bool,
            is_usb: bool,
            last_activity: Instant,
            led_powered: bool,
        }

        impl StatusLed {
            fn current_pattern(&self) -> Pattern {
                // 充電中は黄色点滅で識別
                if self.is_charging {
                    return Pattern::Blink(20, 12, 0);
                }
                // 電池警告は接続表示より優先
                if let Some(lvl) = self.battery_level {
                    if lvl <= 5 {
                        return Pattern::Blink(32, 0, 0); // 緊急: 赤点滅
                    }
                    if lvl <= 20 {
                        return Pattern::Solid(32, 0, 0); // 警告: 赤常時
                    }
                }
                // アイドル(警告と充電以外)は VDD ごと遮断
                if self.last_activity.elapsed() > IDLE_TIMEOUT {
                    return Pattern::Off;
                }
                // 通常表示
                if self.is_usb {
                    return Pattern::Solid(20, 20, 20); // 白 = USB 接続中
                }
                match self.ble_state {
                    BleState::Connected => Pattern::Solid(0, 0, 32), // 青常時 = BLE 接続中
                    BleState::Advertising => Pattern::Blink(0, 0, 32), // 青点滅 = ペアリング待機
                    BleState::None => Pattern::Off,
                }
            }

            async fn power_on(&mut self) {
                if !self.led_powered {
                    self.pmos.set_low(); // PMOS ON → LED VDD 通電
                    Timer::after(Duration::from_micros(500)).await; // VDD 安定待ち
                    self.led_powered = true;
                }
            }

            async fn power_off(&mut self) {
                if self.led_powered {
                    // 一旦黒を流して LED チップの状態をリセットしてから VDD カット
                    let buf = [0u8; SK6812_BYTES];
                    let _ = self.spim.write(&buf).await;
                    Timer::after(Duration::from_micros(100)).await;
                    self.pmos.set_high(); // PMOS OFF → LED VDD 遮断
                    self.led_powered = false;
                }
            }

            async fn write_color(&mut self, r: u8, g: u8, b: u8) {
                self.power_on().await;
                let mut buf = [0u8; SK6812_BYTES];
                encode_sk6812([g, r, b], &mut buf); // SK6812 ワイヤ順は GRB
                let _ = self.spim.write(&buf).await;
            }
        }

        impl Controller for StatusLed {
            type Event = ControllerEvent;

            async fn process_event(&mut self, event: Self::Event) {
                match event {
                    ControllerEvent::Battery(level) => self.battery_level = Some(level),
                    ControllerEvent::ChargingState(c) => self.is_charging = c,
                    ControllerEvent::BleState(_, s) => self.ble_state = s,
                    ControllerEvent::ConnectionType(t) => self.is_usb = t == 0,
                    ControllerEvent::Key(_, _) => self.last_activity = Instant::now(),
                    _ => {}
                }
            }

            async fn next_message(&mut self) -> Self::Event {
                self.sub.next_message_pure().await
            }
        }

        impl PollingController for StatusLed {
            const INTERVAL: Duration = POLL_INTERVAL;

            async fn update(&mut self) {
                let pattern = self.current_pattern();
                let blink_on = (Instant::now().as_millis() / BLINK_HALF_PERIOD_MS) % 2 == 0;
                match pattern {
                    Pattern::Off => self.power_off().await,
                    Pattern::Solid(r, g, b) => self.write_color(r, g, b).await,
                    Pattern::Blink(r, g, b) => {
                        if blink_on {
                            self.write_color(r, g, b).await;
                        } else {
                            self.write_color(0, 0, 0).await;
                        }
                    }
                }
            }
        }

        fn encode_sk6812(grb: [u8; 3], buf: &mut [u8; SK6812_BYTES]) {
            for b in buf.iter_mut() {
                *b = 0;
            }
            let mut byte_idx = 0usize;
            let mut high_nibble = true;
            for byte in grb {
                for i in (0..8).rev() {
                    let led_bit = (byte >> i) & 1;
                    let nibble: u8 = if led_bit == 1 { 0b1100 } else { 0b1000 };
                    if high_nibble {
                        buf[byte_idx] = nibble << 4;
                        high_nibble = false;
                    } else {
                        buf[byte_idx] |= nibble;
                        byte_idx += 1;
                        high_nibble = true;
                    }
                }
            }
        }

        // ----- 初期化 -----
        // SPIM3 を 4 MHz / MODE_0 / MSB-first で構成。SCK 不要 (1-wire LED) のため new_txonly_nosck。
        // Config は #[non_exhaustive] のため Default を経由して書き換える。
        let mut spim_config = spim::Config::default();
        spim_config.frequency = spim::Frequency::M4;
        spim_config.mode = spim::MODE_0;
        let spim = Spim::new_txonly_nosck(p.SPI3, Irqs, p.P1_15, spim_config);

        // PMOS ゲートは初期 HIGH (LED VDD 遮断)。アクティブ時のみ LOW にする。
        let pmos = Output::new(p.P0_30, Level::High, OutputDrive::Standard);

        let sub = ::defmt::unwrap!(CONTROLLER_CHANNEL.subscriber());

        StatusLed {
            spim,
            pmos,
            sub,
            ble_state: BleState::Advertising,
            battery_level: None,
            is_charging: false,
            is_usb: false,
            last_activity: Instant::now(),
            led_powered: false,
        }
    }
}

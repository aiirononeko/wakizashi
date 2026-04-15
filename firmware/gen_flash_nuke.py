import struct

M0, M1, ME = 0x0A324655, 0x9E5D5157, 0x0AB16F30
FLAGS = 0x2000
FAMILY = 0xADA52840
BLOCK_SIZE = 256

# nRF52840 application flash: 0x1000 ~ 0xFFFFF (approx 1MB minus bootloader)
# Includes RMK storage region at 0xA0000 (32 sectors x 4KB = 128KB)
START_ADDR = 0x1000
END_ADDR = 0xC8000  # 0xA0000 + 32*4096 = 0xC8000
TOTAL = (END_ADDR - START_ADDR) // BLOCK_SIZE

with open("flash_nuke.uf2", "wb") as f:
    for i in range(TOTAL):
        header = struct.pack("<IIIIIIII",
            M0, M1, FLAGS, START_ADDR + i * BLOCK_SIZE,
            BLOCK_SIZE, i, TOTAL, FAMILY)
        data = b"\x00" * BLOCK_SIZE
        padding = b"\x00" * 220
        footer = struct.pack("<I", ME)
        f.write(header + data + padding + footer)

print(f"Generated flash_nuke.uf2 (nRF52840, {TOTAL} blocks, 0x{START_ADDR:X}-0x{END_ADDR:X})")

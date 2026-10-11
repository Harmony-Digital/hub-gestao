import { describe, expect, it } from "vitest";
import config, { ATTACHMENT_BODY_LIMIT } from "../../next.config";
import { MAX_ATTACHMENT_BYTES } from "@/modules/attachments/service";

const MB = 1024 * 1024;

describe("limite do corpo dos envios", () => {
  it("passa o anexo de 25 MB pela ação e pelo proxy", () => {
    // Sem o limite do proxy, o Next corta em 10 MB antes da ação e a página cai.
    expect(config.experimental?.serverActions?.bodySizeLimit).toBe(
      ATTACHMENT_BODY_LIMIT,
    );
    expect(config.experimental?.proxyClientMaxBodySize).toBe(
      ATTACHMENT_BODY_LIMIT,
    );
    expect(Number.parseInt(ATTACHMENT_BODY_LIMIT, 10) * MB).toBeGreaterThan(
      MAX_ATTACHMENT_BYTES,
    );
  });
});

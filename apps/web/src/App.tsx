import { useMemo, useState } from "react";
import { createWebChain, type WebChain } from "./chain/adapter";
import { configFromEnv, type WebChainConfig } from "./chain/config";
import { FAKE_ARTIFACT, MockPlatform, seedClaimedReviewOrder, withSimulatedMirrorLag } from "./chain/mockPlatform";
import { ConnectScreen, type ConnectOutcome } from "./screens/ConnectScreen";
import { SignScreen } from "./screens/SignScreen";
import { describeConnectError, type ExpertConnection } from "./session/connect";
import { describeError } from "./sign/runSign";
import { MIRROR_EXPECTED_LAG_MS } from "./sign/settlement";
import type { OrderForSigning } from "./sign/sign";
import { useSignFlow, type SignFlowDeps } from "./sign/useSignFlow";

/**
 * Everything the sign screen needs, resolved once per connection.
 *
 * In mock mode the app also plays the requester who posts the order and the
 * platform that releases payment, because there is nobody else to. On testnet
 * both are real and absent from here: the inbox hands over a claimed order,
 * and payment is read from the mirror node rather than triggered.
 */
interface Booted {
  readonly config: WebChainConfig;
  readonly chain: WebChain;
  readonly order: OrderForSigning;
  readonly artifactText: string | null;
  readonly deps: SignFlowDeps;
}

/**
 * The app is a short state machine: connect, then sign, then back to connect
 * on disconnect. Nothing is persisted, so a reload is also a disconnect.
 */
type AppState = { kind: "connect"; notice: string | null } | { kind: "ready"; booted: Booted };

async function boot(config: WebChainConfig, connection: ExpertConnection): Promise<Booted> {
  const chain = createWebChain(config, connection);

  if (config.mode !== "mock" || chain.mode !== "mock") {
    // Unreachable today: createWebChain throws for testnet until the cutover.
    // When the real adapter lands, the inbox hands over the claimed order here
    // and the stand-ins below go away.
    throw new Error("the inbox is not built yet; run with VITE_CHAIN=mock");
  }

  const platform = new MockPlatform(chain.mock, chain.expertAccountId);
  const order = await seedClaimedReviewOrder(chain.mock, {
    ordersTopicId: config.ordersTopicId,
    requesterAccountId: config.mock.requesterAccountId,
    priceHbar: config.mock.priceHbar,
  });

  return {
    config,
    chain,
    order,
    artifactText: FAKE_ARTIFACT,
    deps: {
      chain,
      reader: withSimulatedMirrorLag(chain.mock, MIRROR_EXPECTED_LAG_MS),
      locatePayout: (o) => platform.locator(o.envelope.order_id),
      afterPublish: async (o) => {
        await platform.releasePayment(o);
      },
    },
  };
}

type Config = { readonly ok: true; readonly config: WebChainConfig } | { readonly ok: false; readonly message: string };

function readConfig(): Config {
  try {
    return { ok: true, config: configFromEnv(import.meta.env) };
  } catch (error) {
    return { ok: false, message: describeError(error) };
  }
}

export function App() {
  const config = useMemo(readConfig, []);
  const [state, setState] = useState<AppState>({ kind: "connect", notice: null });

  if (!config.ok) {
    return (
      <main className="mx-auto grid max-w-3xl gap-2 px-4 py-8">
        <h1 className="text-lg font-semibold">The expert app cannot start</h1>
        <p className="text-sm text-muted-foreground">{config.message}</p>
      </main>
    );
  }

  if (state.kind === "connect") {
    const connect = async (connection: ExpertConnection): Promise<ConnectOutcome> => {
      try {
        const booted = await boot(config.config, connection);
        setState({ kind: "ready", booted });
        return { ok: true };
      } catch (error) {
        return { ok: false, message: describeConnectError(error, connection.accountId) };
      }
    };
    return (
      <ConnectScreen
        mode={config.config.mode}
        prefill={config.config.expertAccountIdPrefill}
        notice={state.notice}
        onConnect={connect}
      />
    );
  }

  return (
    <Ready
      booted={state.booted}
      onDisconnect={() => {
        state.booted.chain.disconnect();
        setState({
          kind: "connect",
          notice: "Disconnected. Your attestation, if you published one, stands on the ledger.",
        });
      }}
    />
  );
}

function Ready({ booted, onDisconnect }: { booted: Booted; onDisconnect: () => void }) {
  const deps = useMemo(() => booted.deps, [booted]);
  const flow = useSignFlow(deps);
  return (
    <SignScreen
      mode={booted.config.mode}
      expertAccountId={booted.chain.expertAccountId}
      order={booted.order}
      artifactText={booted.artifactText}
      flow={flow}
      onDisconnect={onDisconnect}
    />
  );
}

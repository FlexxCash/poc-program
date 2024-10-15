// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider } from "@coral-xyz/anchor";

module.exports = async function (provider: AnchorProvider) {
    // Configure client to use the provider.
    anchor.setProvider(provider);

    const program = anchor.workspace.AccessControl;

    console.log("Deploying AccessControl program...");

    try {
        const tx = await program.deploy();
        console.log("AccessControl program deployed with transaction:", tx);
    } catch (error) {
        console.error("Deployment failed:", error);
    }
};

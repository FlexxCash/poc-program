use anchor_lang::prelude::*;

declare_id!("wpeBVdX6k5tUpmv6RvrQ7Ui1AwLHatG6PU8wpwdqVpg");

#[program]
pub mod flexxcash_poc {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
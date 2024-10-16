use anchor_lang::prelude::*;

declare_id!("639MfSvAAe1wMT9fMqouJ9x6dzXaTUGo2fWjFHRoJWBu");

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
use anchor_lang::prelude::*;

declare_id!("FwTC1PQmyLnAavnMi1Q9DKbPTFM2dNEWKsYw97oX8GH4");

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
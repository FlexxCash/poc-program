use anchor_lang::prelude::*;

declare_id!("4fVxYdUoHcPiHSv7wA8fr5dY2R4uBTVKfrc1KgFeaMNh");

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
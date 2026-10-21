{{ config(alias='summary_mart') }}

select * from {{ ref("hub") }}

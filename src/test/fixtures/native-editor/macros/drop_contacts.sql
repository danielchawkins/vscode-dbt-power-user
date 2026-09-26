{% macro drop_contacts() %}
  {% do run_query("drop table if exists main.contacts") %}
{% endmacro %}

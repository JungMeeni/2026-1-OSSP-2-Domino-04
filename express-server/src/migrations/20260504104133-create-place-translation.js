'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('PlaceTranslations', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      place_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Places', // 참조할 테이블 이름
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE' // 장소가 삭제되면 번역도 함께 삭제
      },
      lang_code: {
        type: Sequelize.STRING(10),
        allowNull: false
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      address: {
        type: Sequelize.STRING(500),
        allowNull: true
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });
    await queryInterface.addIndex('PlaceTranslations', ['place_id', 'lang_code'], {
      unique: true, // 한 장소에 같은 언어 번역이 중복되는 것 방지
      name: 'place_translations_place_lang_unique'
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('PlaceTranslations');
  }
};
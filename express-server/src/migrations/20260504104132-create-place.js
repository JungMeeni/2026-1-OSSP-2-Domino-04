'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Places', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      gu_id: {
        type: Sequelize.INTEGER,
        references: {
          model: 'GuBoundaries', //참조할 테이블 이름
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      category: {
        type: Sequelize.ENUM('ACCOMMODATION', 'RESTAURANT', 'CAFE', 'ATTRACTION'),
        allowNull: false
      },
      place_id: {
        type: Sequelize.STRING(100),
        allowNull: false,
        unique: true 
      },
      coordinates: {
        type: Sequelize.GEOMETRY('POINT', 4326),
        allowNull: false
      },
      rating: {
        type: Sequelize.DECIMAL(3, 2)
      },
      num_reviews: {
        type: Sequelize.INTEGER
      },
      cached_at: {
        type: Sequelize.DATE
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    await queryInterface.addIndex('Places', ['coordinates'], {
      type: 'SPATIAL',
      name: 'places_coordinates_spatial'
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Places');
  }
};